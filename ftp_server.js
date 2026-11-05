import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';

const CONTROL_PORT = 2121;
const DATA_PORT = 2122;
const PUBLIC_HOST_IP = process.env.FTP_PUBLIC_IP || '187.77.46.13';

// Cache em memória para resolução DNS dos Cloud DDNS (TTL 60s)
const dnsCache = new Map();

function cleanIp(ip) {
  if (!ip) return '';
  return ip.replace(/^::ffff:/, '').trim();
}

/**
 * Valida se um determinado IP remoto pertence a algum roteador MikroTik cadastrado.
 * Checa tanto o cloud_public_ip quanto resolve o cloud_dns_name.
 */
async function getAuthorizedRouterForIp(remoteIp, db) {
  const normIp = cleanIp(remoteIp);
  if (!normIp) return null;

  try {
    const routers = db.prepare('SELECT id, name, token, cloud_dns_name, cloud_public_ip FROM routers').all();

    for (const r of routers) {
      // 1. Checa IP direto gravado na telemetria
      if (cleanIp(r.cloud_public_ip) === normIp) {
        return r;
      }

      // 2. Se tiver Cloud DNS cadastrado, checa resolução DNS com cache
      if (r.cloud_dns_name && r.cloud_dns_name !== 'N/A' && r.cloud_dns_name.includes('.')) {
        const cached = dnsCache.get(r.cloud_dns_name);
        const now = Date.now();
        let resolvedIps = [];

        if (cached && (now - cached.timestamp < 60000)) {
          resolvedIps = cached.ips;
        } else {
          try {
            const records = await dns.resolve4(r.cloud_dns_name);
            resolvedIps = records || [];
            dnsCache.set(r.cloud_dns_name, { ips: resolvedIps, timestamp: now });
          } catch (e) {
            // DNS pode falhar pontualmente
          }
        }

        if (resolvedIps.includes(normIp)) {
          return r;
        }
      }
    }
  } catch (err) {
    console.error('[FTP SECURITY] Erro ao consultar whitelist no banco:', err.message);
  }

  return null;
}

export function startFtpServer(db, dataDir) {
  const backupsBaseDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupsBaseDir)) {
    fs.mkdirSync(backupsBaseDir, { recursive: true });
  }

  const server = net.createServer(async (socket) => {
    const remoteIp = cleanIp(socket.remoteAddress);

    // =========================================================================
    // CAMADA 1 DE SEGURANÇA: WHITELIST DE IP / CLOUD DDNS NO HANDSHAKE TCP
    // =========================================================================
    const initialRouter = await getAuthorizedRouterForIp(remoteIp, db);
    if (!initialRouter) {
      console.warn(`[FTP SECURITY] Conexão REJEITADA do IP não cadastrado: ${remoteIp} (socket destruído)`);
      socket.destroy();
      return;
    }

    console.log(`[FTP] Conexão autorizada do MikroTik ${initialRouter.name} (IP: ${remoteIp})`);
    socket.write('220 TRACERT+ Secure Backup Service Ready\r\n');

    let userToken = '';
    let authenticatedRouter = null;
    let dataServer = null;
    let dataSocketPromise = null;

    socket.on('data', async (chunk) => {
      const line = chunk.toString('utf8').trim();
      const [cmd, ...args] = line.split(' ');
      const arg = args.join(' ');

      switch (cmd.toUpperCase()) {
        case 'USER': {
          userToken = (arg || '').trim();

          // =====================================================================
          // CAMADA 2 DE SEGURANÇA: VALIDAÇÃO DE TOKEN DO ROTEADOR
          // =====================================================================
          try {
            const r = db.prepare('SELECT id, name, token, cloud_dns_name, cloud_public_ip FROM routers WHERE token = ?').get(userToken);
            if (!r) {
              console.warn(`[FTP SECURITY] Token inválido (${userToken}) vindo do IP: ${remoteIp}`);
              socket.write('530 Authentication failed: Invalid token\r\n');
              socket.destroy();
              return;
            }

            authenticatedRouter = r;
            socket.write('331 Token verified. Send PASS.\r\n');
          } catch (err) {
            console.error('[FTP] Erro ao validar token:', err);
            socket.write('530 Authentication error\r\n');
            socket.destroy();
          }
          break;
        }

        case 'PASS': {
          if (!authenticatedRouter) {
            socket.write('530 Not logged in\r\n');
            socket.destroy();
            return;
          }
          console.log(`[FTP] Autenticado com sucesso: ${authenticatedRouter.name} (${authenticatedRouter.token})`);
          socket.write('230 Router authenticated successfully\r\n');
          break;
        }

        case 'TYPE':
          socket.write('200 Type set to ' + arg + '\r\n');
          break;

        case 'PASV': {
          if (!authenticatedRouter) {
            socket.write('530 Not logged in\r\n');
            return;
          }

          const p1 = (DATA_PORT >> 8) & 0xff;
          const p2 = DATA_PORT & 0xff;
          const ipParts = PUBLIC_HOST_IP.split('.').join(',');

          if (dataServer) {
            try { dataServer.close(); } catch (e) {}
          }

          dataSocketPromise = new Promise((resolve) => {
            dataServer = net.createServer((ds) => {
              const dsIp = cleanIp(ds.remoteAddress);
              // Valida se o socket de dados veio do mesmo IP do controle
              if (dsIp !== remoteIp) {
                console.warn(`[FTP DATA SECURITY] Conexão de dados de IP diferente: ${dsIp} !== ${remoteIp}`);
                ds.destroy();
                return;
              }
              resolve(ds);
            });

            dataServer.listen(DATA_PORT, '0.0.0.0', () => {
              // listening
            });
          });

          socket.write(`227 Entering Passive Mode (${ipParts},${p1},${p2})\r\n`);
          break;
        }

        case 'STOR': {
          if (!authenticatedRouter || !dataSocketPromise) {
            socket.write('503 Bad sequence of commands\r\n');
            return;
          }

          const routerId = authenticatedRouter.id;
          const routerDir = path.join(backupsBaseDir, String(routerId));
          if (!fs.existsSync(routerDir)) {
            fs.mkdirSync(routerDir, { recursive: true });
          }

          const now = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          const cleanName = (authenticatedRouter.name || 'router').replace(/[^a-zA-Z0-9_-]/g, '_');
          const targetFilename = `backup_${cleanName}_${stamp}.rsc`;
          const savePath = path.join(routerDir, targetFilename);

          socket.write(`150 Opening BINARY mode data connection for ${targetFilename}\r\n`);

          dataSocketPromise.then((ds) => {
            const ws = fs.createWriteStream(savePath);
            let bytesCount = 0;

            ds.on('data', (c) => {
              bytesCount += c.length;
              ws.write(c);
            });

            ds.on('end', () => {
              ws.end();
              console.log(`[FTP BACKUP] Backup salvo para ${authenticatedRouter.name}: ${targetFilename} (${bytesCount} bytes)`);

              try {
                // Registra backup no SQLite
                db.prepare(`
                  INSERT INTO router_backups (router_id, filename, file_size, created_at)
                  VALUES (?, ?, ?, datetime('now'))
                `).run(routerId, targetFilename, bytesCount);

                // POLÍTICA DE RETENÇÃO ESTRITA: Manter somente os 4 backups mais recentes
                const backups = db.prepare('SELECT id, filename FROM router_backups WHERE router_id = ? ORDER BY id DESC').all(routerId);
                if (backups.length > 4) {
                  const toDelete = backups.slice(4);
                  for (const b of toDelete) {
                    const oldPath = path.join(routerDir, b.filename);
                    if (fs.existsSync(oldPath)) {
                      try { fs.unlinkSync(oldPath); } catch (e) {}
                    }
                    db.prepare('DELETE FROM router_backups WHERE id = ?').run(b.id);
                    console.log(`[FTP RETENTION] Backup antigo removido: ${b.filename} (RB: ${authenticatedRouter.name})`);
                  }
                }
              } catch (dbErr) {
                console.error('[FTP BACKUP] Erro ao registrar backup no SQLite:', dbErr);
              }

              socket.write('226 Transfer complete\r\n');
              if (dataServer) {
                try { dataServer.close(); } catch (e) {}
              }
            });

            ds.on('error', (err) => {
              console.error('[FTP DATA] Erro no stream de dados:', err);
              socket.write('426 Connection closed; transfer aborted\r\n');
            });
          });
          break;
        }

        case 'SYST':
          socket.write('215 UNIX Type: L8\r\n');
          break;

        case 'FEAT':
          socket.write('211-Features:\r\n PASV\r\n211 End\r\n');
          break;

        case 'QUIT':
          socket.write('221 Goodbye from TRACERT+\r\n');
          socket.end();
          break;

        default:
          socket.write('502 Command not implemented\r\n');
      }
    });

    socket.on('error', (err) => {
      // Ignora desconexões abruptas
    });
  });

  server.listen(CONTROL_PORT, '0.0.0.0', () => {
    console.log(`[TRACERT+] Servidor FTP Seguro de Backups ativo na porta ${CONTROL_PORT} (Whitelist Estrita Ativa)`);
  });

  return server;
}
