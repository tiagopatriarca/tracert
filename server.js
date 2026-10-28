import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, initDatabase } from './db.js';
import { sendEvolutionWhatsapp } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDatabase();

const JWT_SECRET = process.env.JWT_SECRET || 'TRACERT_PLUS_SECRET_KEY_2026_SECURE_NODE_TI';
const app = express();

// Middleware de Segurança (Anti-Clickjacking, Prevenção de MIME Sniffing, Referrer Policy)
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.warn('[TRACERT+] JSON malformado recebido:', err.message);
    req.body = {};
    return next();
  }
  next(err);
});
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.auth_token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso negado: Requer privilégios de Administrador' });
  }
  next();
}

// ----------------------------------------------------------------------
// LOGIN
// ----------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, groupId: user.group_id },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      timeoutMinutes: user.inactivity_timeout_min || 15
    }
  });
});

// ----------------------------------------------------------------------
// TELEMETRIAS DO MIKROTIK (Autenticado via Token do Roteador)
// ----------------------------------------------------------------------
function getRouterByToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM routers WHERE token = ?').get(token);
}

function touchRouterSeen(router) {
  try {
    if (router && router.offline_notified === 1) {
      db.prepare("UPDATE routers SET last_seen = datetime('now'), offline_notified = 0 WHERE id = ?").run(router.id);
      const msg = `✅ *TRACERT+: MIKROTIK ONLINE*\n\n📍 *Roteador:* ${router.name}\n🟢 *Status:* Comunicação e telemetria restabelecidas!\n⏰ *Data/Hora:* ${new Date().toLocaleString('pt-BR')}`;
      sendEvolutionWhatsapp('ROUTER_OFFLINE', router.id, msg);
    } else if (router) {
      db.prepare("UPDATE routers SET last_seen = datetime('now') WHERE id = ?").run(router.id);
    }
  } catch (err) {
    if (router) db.prepare("UPDATE routers SET last_seen = datetime('now') WHERE id = ?").run(router.id);
  }
}

// 1. Telemetria de Hardware e Sistema (/system resource e /system routerboard)
app.post(['/api/telemetry/system', '/api/telemetry/system/:token'], (req, res) => {
  const token = req.params.token || req.query.token || (req.body && req.body.token);
  const router = getRouterByToken(token);
  if (!router) return res.status(401).json({ error: 'Token inválido' });

  const data = { ...req.query, ...req.body };
  const model = data.model;
  const routerosVersion = data.routerosVersion;
  const firmwareVersion = data.firmwareVersion;
  const cpuModel = data.cpuModel;
  const cpuCount = data.cpuCount;
  const cpuLoad = data.cpuLoad;
  const totalMemory = data.totalMemory;
  const freeMemory = data.freeMemory;
  const uptime = data.uptime;
  const serialNumber = data.serialNumber;

  touchRouterSeen(router);

  db.prepare(`
    UPDATE routers SET
      model = COALESCE(?, model),
      routeros_version = ?,
      firmware_version = ?,
      cpu_model = ?,
      cpu_count = ?,
      cpu_load = ?,
      total_memory = ?,
      free_memory = ?,
      uptime = ?,
      serial_number = ?,
      offline_notified = 0,
      last_seen = datetime('now')
    WHERE id = ?
  `).run(
    model ?? null, routerosVersion ?? null, firmwareVersion ?? null,
    cpuModel ?? null, (cpuCount !== undefined && cpuCount !== null) ? Number(cpuCount) : 1, (cpuLoad !== undefined && cpuLoad !== null) ? Number(cpuLoad) : 0,
    (totalMemory !== undefined && totalMemory !== null) ? Number(totalMemory) : 0, (freeMemory !== undefined && freeMemory !== null) ? Number(freeMemory) : 0, uptime ?? null, serialNumber ?? null,
    router.id
  );

    // Auto-provisionamento inicial: se for primeira conexão da RB, agenda SD-WAN apropriado (v6 ou v7) e destinos
  const existingCmds = db.prepare('SELECT count(*) as count FROM router_commands WHERE router_id = ?').get(router.id);
  if (existingCmds && existingCmds.count === 0) {
    try {
      const updatedRouter = db.prepare('SELECT * FROM routers WHERE id = ?').get(router.id);
      const isV6 = isRouterOSv6(updatedRouter);
      const otaScript = generateOtaSdwanScript(updatedRouter);
      enqueueCommand(router.id, 'OTA_SDWAN', `Auto-Provisionamento Script SD-WAN (${isV6 ? 'v6' : 'v7'})`, otaScript);
      const syncTargets = generateSyncTargetsScript(router.id);
      enqueueCommand(router.id, 'SYNC_TARGETS', 'Auto-Provisionamento Destinos SD-WAN', syncTargets);
      console.log(`[TRACERT+] Auto-provisionamento agendado para ${router.name} (RouterOS ${isV6 ? 'v6' : 'v7'})`);
    } catch (err) {
      console.error('[TRACERT+] Erro no auto-provisionamento:', err);
    }
  }

  res.json({ success: true, router: router.name });
});

// 2. Failover Link ON/OFF
app.post(['/api/telemetry/failover', '/api/telemetry/failover/:token'], async (req, res) => {
  const token = req.params.token || req.query.token || (req.body && req.body.token);
  const router = getRouterByToken(token);
  if (!router) return res.status(401).json({ error: 'Token inválido' });

  touchRouterSeen(router);

  const data = { ...req.query, ...req.body };
  const linkName = data.link || data.linkName || 'LINK-WAN';
  const linkStatus = (data.status || 'UP').toUpperCase();
  let pingScore = 0;
  if (data.score !== undefined && data.score !== null && data.score !== '') {
    pingScore = parseInt(data.score, 10);
    if (isNaN(pingScore)) pingScore = (linkStatus === 'UP' ? 8 : 0);
  } else {
    pingScore = (linkStatus === 'UP' ? 8 : 0);
  }
  console.log(`[FAILOVER TELEMETRY] Router: ${router.name} (${router.token}) | Link: ${linkName} | Status: ${linkStatus} | Score: ${pingScore}/8`);

  const prev = db.prepare('SELECT status, last_changed FROM link_statuses WHERE router_id = ? AND link_name = ?').get(router.id, linkName);
  const statusMudou = !prev || prev.status !== linkStatus;

  db.prepare(`
    INSERT INTO link_statuses (router_id, link_name, status, score, last_changed, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(router_id, link_name) DO UPDATE SET
      status = excluded.status,
      score = excluded.score,
      last_changed = CASE WHEN link_statuses.status != excluded.status THEN datetime('now') ELSE link_statuses.last_changed END,
      updated_at = datetime('now')
  `).run(router.id, linkName, linkStatus, pingScore);

  if (statusMudou) {
    db.prepare('INSERT INTO link_events (router_id, link_name, status, score) VALUES (?, ?, ?, ?)').run(router.id, linkName, linkStatus, pingScore);

    if (linkStatus === 'DOWN') {
      db.prepare("INSERT INTO link_outages (router_id, link_name, down_time) VALUES (?, ?, datetime('now'))").run(router.id, linkName);
      const msg = `🚨 *TRACERT+: QUEDA DE LINK*\n\n📍 *Roteador:* ${router.name}\n🌐 *Link:* ${linkName}\n🔴 *Status:* DOWN\n⚠️ *Score de Pings:* ${pingScore}/8\n⏰ *Data/Hora:* ${new Date().toLocaleString('pt-BR')}`;
      sendEvolutionWhatsapp('LINK_DOWN', router.id, msg);
    } else if (linkStatus === 'UP') {
      const lastOutage = db.prepare('SELECT id, down_time FROM link_outages WHERE router_id = ? AND link_name = ? AND up_time IS NULL ORDER BY id DESC LIMIT 1').get(router.id, linkName);
      if (lastOutage) {
        db.prepare(`
          UPDATE link_outages SET 
            up_time = datetime('now'),
            duration_seconds = CAST((strftime('%s', 'now') - strftime('%s', down_time)) AS INTEGER)
          WHERE id = ?
        `).run(lastOutage.id);
      }
      const msg = `✅ *TRACERT+: RETORNO DE LINK*\n\n📍 *Roteador:* ${router.name}\n🌐 *Link:* ${linkName}\n🟢 *Status:* UP (Normalizado)\n⏰ *Data/Hora:* ${new Date().toLocaleString('pt-BR')}`;
      sendEvolutionWhatsapp('LINK_DOWN', router.id, msg);
    }
  }

  res.json({ success: true, router: router.name, link: linkName, status: linkStatus });
});

// 3. SD-WAN Telemetria
app.post(['/api/telemetry/sdwan', '/api/telemetry/sdwan/:token'], async (req, res) => {
  const token = req.params.token || req.query.token || req.body.token;
  const router = getRouterByToken(token);
  if (!router) return res.status(401).json({ error: 'Token inválido' });

  touchRouterSeen(router);

  const { nomeDestino, endereco, linkAtivo, linkAnterior, melhorRtt, melhorPerda, testes } = req.body;
  const cleanEndereco = (endereco || '').replace(/["\r\n;\\]/g, '').trim();
  if (!cleanEndereco || !/^[a-zA-Z0-9.:_/-]+$/.test(cleanEndereco)) {
    return res.status(400).json({ error: 'endereco obrigatorio e deve ser IP ou host valido' });
  }

  const name = (nomeDestino || cleanEndereco).replace(/["\r\n;\\]/g, '').trim();
  const rtt = parseFloat(melhorRtt || 0);
  const loss = parseFloat(melhorPerda || 0);

  db.prepare(`
    INSERT INTO sdwan_targets (router_id, name, address, active_link, metric_rtt, metric_loss, last_tested)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(router_id, address) DO UPDATE SET
      name = excluded.name,
      active_link = excluded.active_link,
      metric_rtt = excluded.metric_rtt,
      metric_loss = excluded.metric_loss,
      last_tested = datetime('now')
  `).run(router.id, name, cleanEndereco, linkAtivo, rtt, loss);

  const target = db.prepare('SELECT id FROM sdwan_targets WHERE router_id = ? AND address = ?').get(router.id, cleanEndereco);

  if (Array.isArray(testes)) {
    const insertMetric = db.prepare("INSERT INTO sdwan_metrics (target_id, link_name, rtt, loss, tested_at) VALUES (?, ?, ?, ?, datetime('now'))");
    for (const t of testes) {
      if (t.rtt < 999999) {
        insertMetric.run(target.id, t.link, parseFloat(t.rtt), parseFloat(t.perda || 0));
      }
    }
  }

  const currentHistory = db.prepare('SELECT * FROM sdwan_history WHERE target_id = ? AND is_current = 1').get(target.id);

  if (!currentHistory) {
    db.prepare(`
      INSERT INTO sdwan_history (target_id, link_name, started_at, is_current, test_count, avg_rtt, jitter)
      VALUES (?, ?, datetime('now'), 1, 1, ?, ?)
    `).run(target.id, linkAtivo, rtt, rtt);
  } else if (currentHistory.link_name !== linkAtivo) {
    db.prepare("UPDATE sdwan_history SET ended_at = datetime('now'), is_current = 0 WHERE id = ?").run(currentHistory.id);
    db.prepare(`
      INSERT INTO sdwan_history (target_id, link_name, started_at, is_current, test_count, avg_rtt, jitter)
      VALUES (?, ?, datetime('now'), 1, 1, ?, ?)
    `).run(target.id, linkAtivo, rtt, rtt);

    const msg = `🔀 *TRACERT+: TROCA DE ROTA SD-WAN*\n\n📍 *Roteador:* ${router.name}\n🎯 *Destino:* ${name} (${endereco})\n🔄 *De:* ${currentHistory.link_name} ➔ *Para:* ${linkAtivo}\n⚡ *Nova Métrica (RTT):* ${rtt.toFixed(2)}ms\n⏰ *Data/Hora:* ${new Date().toLocaleString('pt-BR')}`;
    sendEvolutionWhatsapp('SDWAN', router.id, msg);
  } else {
    db.prepare(`
      UPDATE sdwan_history SET
        test_count = test_count + 1,
        avg_rtt = ((avg_rtt * test_count) + ?) / (test_count + 1),
        jitter = ?
      WHERE id = ?
    `).run(rtt, rtt, currentHistory.id);
  }

  res.json({ success: true, target: name, activeLink: linkAtivo });
});

// 4. Sincronização e Execução de Comandos Remotos OTA (Modelo 2)
app.get(['/api/routers/sync', '/api/routers/sync/:token'], (req, res) => {
  const token = req.params.token || req.query.token;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (!token) return res.status(401).send('# [TRACERT+] Erro: Token obrigatorio\n');
  const router = getRouterByToken(token);
  if (!router) return res.status(401).send('# [TRACERT+] Erro: Token invalido\n');

  // Atualiza heartbeat do roteador e trata retorno se estava offline
  touchRouterSeen(router);

  // Busca comandos pendentes na fila
  const pending = db.prepare(`
    SELECT * FROM router_commands 
    WHERE router_id = ? AND status = 'PENDING' 
    ORDER BY id ASC LIMIT 5
  `).all(router.id);

  if (!pending || pending.length === 0) {
    return res.send('# TRACERT+ Sync: OK (Sem comandos pendentes)\n');
  }

  let rsc = `# ========================================================\n`;
  rsc += `# TRACERT+ BATCH DE EXECUCAO - ${router.name}\n`;
  rsc += `# Data de Geracao: ${new Date().toISOString()}\n`;
  rsc += `# Comandos na fila: ${pending.length}\n`;
  rsc += `# ========================================================\n\n`;

  const markExecuted = db.prepare(`
    UPDATE router_commands 
    SET status = 'EXECUTED', fetched_at = datetime('now'), executed_at = datetime('now') 
    WHERE id = ?
  `);

  for (const cmd of pending) {
    rsc += `# Comando ID ${cmd.id} [${cmd.command_type}] - ${cmd.command_name || 'Comando'}\n`;
    rsc += `${cmd.payload}\n`;
    rsc += `/log info message=("[TRACERT+] Comando ID ${cmd.id} (${cmd.command_name || cmd.command_type}) executado!");\n\n`;

    markExecuted.run(cmd.id);
  }

  res.send(rsc);
});


// ----------------------------------------------------------------------
// PAINEL CENTRAL (DASHBOARD GERAL / HOME)
// ----------------------------------------------------------------------
app.get('/api/dashboard/overview', authMiddleware, (req, res) => {
  // Retorna resumo geral para a tela inicial
  let routerFilter = '';
  let params = [];
  if (req.user.role !== 'ADMIN') {
    routerFilter = 'JOIN group_routers gr ON gr.router_id = r.id WHERE gr.group_id = ?';
    params.push(req.user.groupId);
  }

  const totalRouters = db.prepare(`SELECT count(DISTINCT r.id) as count FROM routers r ${routerFilter}`).get(...params)?.count || 0;
  
  // Roteadores Online (last_seen < 5 minutos)
  const onlineRouters = db.prepare(`
    SELECT count(DISTINCT r.id) as count FROM routers r 
    ${routerFilter ? routerFilter + ' AND ' : 'WHERE '} 
    datetime(r.last_seen, '+5 minutes') >= datetime('now')
  `).get(...params)?.count || 0;

  // Links Atualmente OFFLINE
  const linksDownQuery = `
    SELECT ls.link_name, ls.last_changed, r.name as router_name, c.name as client_name
    FROM link_statuses ls
    JOIN routers r ON r.id = ls.router_id
    JOIN clients c ON c.id = r.client_id
    ${routerFilter ? 'JOIN group_routers gr ON gr.router_id = r.id WHERE gr.group_id = ? AND ' : 'WHERE '}
    ls.status = 'DOWN'
    ORDER BY ls.last_changed DESC
  `;
  const linksDown = db.prepare(linksDownQuery).all(...params);

  // Últimos Eventos de Queda / Retorno
  const recentEventsQuery = `
    SELECT le.*, r.name as router_name, c.name as client_name
    FROM link_events le
    JOIN routers r ON r.id = le.router_id
    JOIN clients c ON c.id = r.client_id
    ${routerFilter ? 'JOIN group_routers gr ON gr.router_id = r.id WHERE gr.group_id = ?' : ''}
    ORDER BY le.created_at DESC LIMIT 10
  `;
  const recentEvents = db.prepare(recentEventsQuery).all(...params);

  res.json({
    totalRouters,
    onlineRouters,
    offlineRouters: Math.max(0, totalRouters - onlineRouters),
    totalLinksDown: linksDown.length,
    linksDown,
    recentEvents
  });
});

// ----------------------------------------------------------------------
// CRUD DE CLIENTES
// ----------------------------------------------------------------------
app.get('/api/clients', authMiddleware, (req, res) => {
  if (req.user.role === 'ADMIN') {
    return res.json(db.prepare('SELECT * FROM clients ORDER BY name ASC').all());
  }
  const clients = db.prepare(`
    SELECT DISTINCT c.* 
    FROM clients c
    JOIN routers r ON r.client_id = c.id
    JOIN group_routers gr ON gr.router_id = r.id
    WHERE gr.group_id = ?
    ORDER BY c.name ASC
  `).all(req.user.groupId);
  res.json(clients);
});

app.post('/api/clients', authMiddleware, adminOnly, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const result = db.prepare('INSERT INTO clients (name, description) VALUES (?, ?)').run(name, description || '');
  res.json({ id: result.lastInsertRowid, name, description });
});

app.put('/api/clients/:id', authMiddleware, adminOnly, (req, res) => {
  const { name, description } = req.body;
  db.prepare('UPDATE clients SET name = ?, description = ? WHERE id = ?').run(name, description || '', req.params.id);
  res.json({ success: true });
});

app.delete('/api/clients/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ----------------------------------------------------------------------
// CRUD DE MIKROTIKS (ROUTERBOARDS)
// ----------------------------------------------------------------------
app.get('/api/routers', authMiddleware, (req, res) => {
  const clientId = req.query.clientId;
  let query = 'SELECT r.*, c.name as client_name FROM routers r JOIN clients c ON c.id = r.client_id';
  let params = [];

  if (req.user.role !== 'ADMIN') {
    query += ' JOIN group_routers gr ON gr.router_id = r.id WHERE gr.group_id = ?';
    params.push(req.user.groupId);
    if (clientId) {
      query += ' AND r.client_id = ?';
      params.push(clientId);
    }
  } else {
    if (clientId) {
      query += ' WHERE r.client_id = ?';
      params.push(clientId);
    }
  }

  query += ' ORDER BY r.name ASC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/routers', authMiddleware, adminOnly, (req, res) => {
  const { clientId, name, model, has_sdwan } = req.body;
  if (!clientId || !name) return res.status(400).json({ error: 'Cliente e Nome são obrigatórios' });

  const sdwanFlag = (has_sdwan === 0 || has_sdwan === false || has_sdwan === '0') ? 0 : 1;
  const token = 'MK-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const result = db.prepare('INSERT INTO routers (client_id, name, token, model, has_sdwan) VALUES (?, ?, ?, ?, ?)').run(clientId, name, token, model || 'RouterOS', sdwanFlag);
  res.json({ id: result.lastInsertRowid, clientId, name, token, model, has_sdwan: sdwanFlag });
});

app.put('/api/routers/:id', authMiddleware, adminOnly, (req, res) => {
  const { clientId, name, model, has_sdwan } = req.body;
  const sdwanFlag = (has_sdwan === 0 || has_sdwan === false || has_sdwan === '0') ? 0 : 1;
  db.prepare('UPDATE routers SET client_id = ?, name = ?, model = ?, has_sdwan = ? WHERE id = ?').run(clientId, name, model, sdwanFlag, req.params.id);
  res.json({ success: true });
});

app.delete('/api/routers/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM routers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ----------------------------------------------------------------------
// CRUD DE DESTINOS SD-WAN
// ----------------------------------------------------------------------
app.get('/api/routers/:id/sdwan', authMiddleware, (req, res) => {
  const routerId = req.params.id;
  const targets = db.prepare('SELECT * FROM sdwan_targets WHERE router_id = ? ORDER BY name ASC').all(routerId);
  const getSparkline = db.prepare('SELECT rtt FROM sdwan_metrics WHERE target_id = ? ORDER BY tested_at DESC LIMIT 15');
  const enriched = targets.map(t => ({
    ...t,
    sparkline: getSparkline.all(t.id).map(p => p.rtt).reverse()
  }));
  res.json(enriched);
});

// Criar destino SD-WAN pelo painel
app.post('/api/routers/:id/sdwan', authMiddleware, adminOnly, (req, res) => {
  const routerId = req.params.id;
  const { name, address } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Nome e Endereço são obrigatórios' });

  const cleanAddress = (address || '').replace(/["\r\n;\\]/g, '').trim();
  if (!cleanAddress || !/^[a-zA-Z0-9.:_/-]+$/.test(cleanAddress)) {
    return res.status(400).json({ error: 'Endereço inválido. Informe um IP ou Hostname válido.' });
  }
  const cleanName = (name || cleanAddress).replace(/["\r\n;\\]/g, '').trim();

  const result = db.prepare(`
    INSERT INTO sdwan_targets (router_id, name, address, active_link, metric_rtt, metric_loss, last_tested)
    VALUES (?, ?, ?, 'Aguardando', 0, 0, datetime('now'))
    ON CONFLICT(router_id, address) DO UPDATE SET name = excluded.name
  `).run(routerId, cleanName, cleanAddress);

  try {
    const syncScript = generateSyncTargetsScript(routerId);
    enqueueCommand(routerId, 'SYNC_TARGETS', 'Auto-Sync: Novo Destino ' + cleanName, syncScript);
  } catch (err) {
    console.error('Falha ao auto-enfileirar sync de destino:', err);
  }

  res.json({ id: result.lastInsertRowid, name: cleanName, address: cleanAddress });
});

app.delete('/api/sdwan/:targetId', authMiddleware, adminOnly, (req, res) => {
  const target = db.prepare('SELECT router_id, name FROM sdwan_targets WHERE id = ?').get(req.params.targetId);
  db.prepare('DELETE FROM sdwan_targets WHERE id = ?').run(req.params.targetId);
  if (target) {
    try {
      const syncScript = generateSyncTargetsScript(target.router_id);
      enqueueCommand(target.router_id, 'SYNC_TARGETS', 'Auto-Sync: Removido ' + target.name, syncScript);
    } catch (err) {
      console.error('Falha ao auto-enfileirar sync de remocao:', err);
    }
  }
  res.json({ success: true });
});

// Demais endpoints de timeline, métricas e links
app.get('/api/sdwan/:targetId/timeline', authMiddleware, (req, res) => {
  const targetId = req.params.targetId;
  const target = db.prepare('SELECT * FROM sdwan_targets WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });
  const history = db.prepare('SELECT * FROM sdwan_history WHERE target_id = ? ORDER BY started_at DESC LIMIT 50').all(targetId);
  res.json({ target, history });
});

app.get('/api/sdwan/:targetId/metrics', authMiddleware, (req, res) => {
  const targetId = req.params.targetId;
  const target = db.prepare('SELECT * FROM sdwan_targets WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Destino não encontrado' });

  // Busca as 120 medições mais recentes e inverte para ordem cronológica no gráfico
  const limit = parseInt(req.query.limit || 120, 10);
  const recent = db.prepare(`
    SELECT link_name, rtt, loss, tested_at 
    FROM sdwan_metrics 
    WHERE target_id = ? 
    ORDER BY id DESC 
    LIMIT ?
  `).all(targetId, limit);

  res.json({ target, metrics: recent.reverse() });
});

app.get('/api/routers/:id/links', authMiddleware, (req, res) => {
  const routerId = req.params.id;
  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId);
  if (!router) return res.status(404).json({ error: 'Roteador não encontrado' });

  let links = db.prepare('SELECT * FROM link_statuses WHERE router_id = ? ORDER BY link_name ASC').all(routerId);
  const events = db.prepare('SELECT * FROM link_events WHERE router_id = ? ORDER BY created_at DESC LIMIT 30').all(routerId);

  // Se a RB ainda não registrou links via failover, sintetiza o status com base no heartbeat
  const isOnline = router.last_seen && ((Date.now() - new Date(router.last_seen.replace(' ', 'T') + 'Z').getTime()) < 5 * 60 * 1000);

  if (links.length === 0) {
    const linkLabel = (router.has_sdwan === 0) ? 'LINK PRINCIPAL (WAN)' : 'LINK WAN (Auto-Detect)';
    links = [{
      id: 0,
      router_id: router.id,
      link_name: linkLabel,
      status: isOnline ? 'UP' : 'DOWN',
      score: isOnline ? 8 : 0,
      last_changed: router.last_seen || router.created_at,
      updated_at: router.last_seen || router.created_at
    }];
  } else if (router.has_sdwan === 0 && !isOnline) {
    // Para RBs de 1 link sem SD-WAN, se o roteador não se comunica há mais de 5 minutos, reflete o link como DOWN
    links = links.map(l => ({ ...l, status: 'DOWN', score: 0 }));
  }

  res.json({ links, events });
});

// ----------------------------------------------------------------------
// GESTÃO REMOTA & FILA DE COMANDOS OTA (MODELO 2)
// ----------------------------------------------------------------------
function enqueueCommand(routerId, type, name, payload) {
  return db.prepare(`
    INSERT INTO router_commands (router_id, command_type, command_name, payload, status)
    VALUES (?, ?, ?, ?, 'PENDING')
  `).run(routerId, type, name, payload);
}

function generateSyncTargetsScript(routerId) {
  const router = db.prepare('SELECT name FROM routers WHERE id = ?').get(routerId);
  const targets = db.prepare('SELECT name, address FROM sdwan_targets WHERE router_id = ?').all(routerId);
  let rsc = `:log info message="[TRACERT+] Sincronizando address-list SDWAN_TARGETS...";\n`;
  rsc += `/ip firewall address-list remove [find list="SDWAN_TARGETS" dynamic=no];\n`;
  for (const t of targets) {
    const cleanAddress = (t.address || '').replace(/["\r\n;\\]/g, '').trim();
    if (!/^[a-zA-Z0-9.:_/-]+$/.test(cleanAddress)) continue; // rejeita quebra de comando RouterOS
    const cleanName = (t.name || cleanAddress).replace(/["\r\n;\\]/g, '').trim();
    rsc += `/ip firewall address-list add list="SDWAN_TARGETS" address="${cleanAddress}" comment="${cleanName}";\n`;
  }
  rsc += `:log info message="[TRACERT+] address-list SDWAN_TARGETS atualizada (${targets.length} destinos).";\n`;
  return rsc;
}

function isRouterOSv6(router) {
  const v = (router.routeros_version || '').trim();
  return v.startsWith('6.') || v.includes(' 6.') || v.startsWith('v6');
}

function generateOtaSdwanScriptV6(router) {
  return `/system script remove [find name="sdwan_monitor"]
/system script add dont-require-permissions=no name="sdwan_monitor" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # --- CONFIGURACOES DO TRACERT+ (ROUTEROS v6) ---
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/sdwan"
    :local routerToken "${router.token}"
    :local listName "SDWAN_TARGETS"
    :local pingCount 3
    :local pingInterval 00:00:00.2
    :global foRouterName [/system identity get name]

    :local linkNames [:toarray ""]
    :local linkGws [:toarray ""]
    :foreach r in=[/ip route find dst-address=0.0.0.0/0] do={
        :local rCmt [/ip route get $r comment]
        :if ([:len $rCmt] > 0 and ($rCmt ~ "[Ll][Ii][Nn][Kk]") and !($rCmt ~ "!==")) do={
            :local rClean $rCmt
            :local rHash [:find $rCmt "#"]
            :if ([:typeof $rHash] = "num") do={ :set rClean [:pick $rCmt 0 $rHash] }
            :local rGw [/ip route get $r gateway]
            :set linkNames ($linkNames, $rClean)
            :set linkGws ($linkGws, $rGw)
        }
    }

    :foreach entry in=[/ip firewall address-list find list=$listName] do={
        :local targetAddress [/ip firewall address-list get $entry address]
        :local targetComment [/ip firewall address-list get $entry comment]
        :local isDynamic [/ip firewall address-list get $entry dynamic]

        :local ipParaTestar $targetAddress
        :local nomeExibicao $targetComment
        :local processar false

        :local dynEntry [/ip firewall address-list find list=$listName comment=$targetAddress dynamic=yes]
        :if ([:len $dynEntry] > 0) do={
            :set ipParaTestar [/ip firewall address-list get ($dynEntry->0) address]
            :set processar true
        } else={
            :if ($isDynamic = false) do={
                :set ipParaTestar $targetAddress
                :set processar true
            }
        }

        :if ($processar = true) do={
            :if ([:len $nomeExibicao] = 0) do={ :set nomeExibicao $targetAddress }

            :local melhorLink ""
            :local melhorGw ""
            :local menorPerda 100
            :local menorRtt 999999
            :local linksDataJson ""

            :local rotaAtualId [/ip route find dst-address=($ipParaTestar . "/32") comment~"SDWAN_AUTO"]
            :local linkAtualName "PADRAO"
            :if ([:len $rotaAtualId] > 0) do={
                :local cmtAtual [/ip route get $rotaAtualId comment]
                :set linkAtualName [:pick $cmtAtual ([:find $cmtAtual "via "] + 4) [:len $cmtAtual]]
            }

            :for i from=0 to=([:len $linkNames] - 1) do={
                :local linkName ($linkNames->$i)
                :local ifaceName ($linkIfaces->$i)
                :local gw ($linkGws->$i)

                :local recebidos [/ping $ipParaTestar interface=$ifaceName count=$pingCount interval=$pingInterval]
                :local perda 100
                :local mediaRtt 999999

                # Medicao de RTT real para RouterOS v6 via /tool flood-ping
                :if ($recebidos > 0) do={
                    :set perda (100 - (($recebidos * 100) / $pingCount))
                    :do {
                        :local fp [/tool flood-ping $ipParaTestar count=$pingCount interface=$ifaceName as-value]
                        :local rttVal ($fp->"avg-rtt")
                        :if ([:typeof $rttVal] = "num") do={
                            :set mediaRtt $rttVal
                            :if ($mediaRtt = 0) do={ :set mediaRtt 1 }
                        } else={
                            :set mediaRtt 1
                        }
                    } on-error={
                        :set mediaRtt 1
                    }
                }

                :local linkJson ("{\"link\":\"" . $linkName . "\",\"gw\":\"" . $gw . "\",\"perda\":" . $perda . ",\"rtt\":" . $mediaRtt . "}")
                :if ([:len $linksDataJson] > 0) do={
                    :set linksDataJson ($linksDataJson . "," . $linkJson)
                } else={
                    :set linksDataJson $linkJson
                }

                :if ($melhorLink = "") do={
                    :set melhorLink $linkName
                    :set melhorGw $gw
                    :set menorPerda $perda
                    :set menorRtt $mediaRtt
                } else={
                    :if ($perda < $menorPerda) do={
                        :set melhorLink $linkName
                        :set melhorGw $gw
                        :set menorPerda $perda
                        :set menorRtt $mediaRtt
                    } else={
                        :if ($perda = $menorPerda and $mediaRtt < $menorRtt) do={
                            :set melhorLink $linkName
                            :set melhorGw $gw
                            :set menorPerda $perda
                            :set menorRtt $mediaRtt
                        }
                    }
                }
            }

            :local houveTroca false
            :local flagTroca "false"
            :if ($linkAtualName != $melhorLink and $melhorGw != "") do={
                :set houveTroca true
                :set flagTroca "true"
                :do { /ip route remove [find dst-address=($ipParaTestar . "/32") comment~"SDWAN_AUTO"] } on-error={}
                /ip route add dst-address=($ipParaTestar . "/32") gateway=$melhorGw comment=("SDWAN_AUTO [" . $nomeExibicao . "] via " . $melhorLink)
                /log warning message=("[TRACERT+] Destino " . $nomeExibicao . " (" . $ipParaTestar . ") agora via [" . $melhorLink . "] - RTT: " . $menorRtt . "ms | Perda: " . $menorPerda . "%")
            }

            :local payload ("{\"token\":\"" . $routerToken . "\",\"roteador\":\"" . $foRouterName . "\",\"nomeDestino\":\"" . $nomeExibicao . "\",\"endereco\":\"" . $ipParaTestar . "\",\"linkAtivo\":\"" . $melhorLink . "\",\"linkAnterior\":\"" . $linkAtualName . "\",\"houveTroca\":" . $flagTroca . ",\"melhorRtt\":" . $menorRtt . ",\"melhorPerda\":" . $menorPerda . ",\"testes\":[" . $linksDataJson . "]}")
            :do {
                /tool fetch http-method=post http-header-field="Content-Type: application/json" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
            } on-error={
                /log error message=("[TRACERT+] Erro ao enviar telemetria para a API (" . $nomeExibicao . ")")
            }
        }
    }
}
/system scheduler remove [find name="executa_sdwan_monitor"]
/system scheduler add interval=1m name="executa_sdwan_monitor" on-event="sdwan_monitor" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
:log info message="[TRACERT+] Script sdwan_monitor v6 oficial atualizado via OTA com sucesso!";
`;
}

function generateOtaSdwanScriptV7(router) {
  return `/system script remove [find name="sdwan_monitor"]
/system script add dont-require-permissions=no name="sdwan_monitor" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # --- CONFIGURACOES DO TRACERT+ (ROUTEROS v7) ---
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/sdwan"
    :local routerToken "${router.token}"
    :local listName "SDWAN_TARGETS"
    :local pingCount 3
    :local pingInterval 00:00:00.2
    :global foRouterName [/system identity get name]

    :local linkNames [:toarray ""]
    :local linkGws [:toarray ""]
    :foreach r in=[/ip route find dst-address=0.0.0.0/0] do={
        :local rCmt [/ip route get $r comment]
        :if ([:len $rCmt] > 0 and ($rCmt ~ "[Ll][Ii][Nn][Kk]") and !($rCmt ~ "!==")) do={
            :local rClean $rCmt
            :local rHash [:find $rCmt "#"]
            :if ([:typeof $rHash] = "num") do={ :set rClean [:pick $rCmt 0 $rHash] }
            :local rGw [/ip route get $r gateway]
            :set linkNames ($linkNames, $rClean)
            :set linkGws ($linkGws, $rGw)
        }
    }

    :foreach entry in=[/ip firewall address-list find list=$listName] do={
        :local targetAddress [/ip firewall address-list get $entry address]
        :local targetComment [/ip firewall address-list get $entry comment]
        :local isDynamic [/ip firewall address-list get $entry dynamic]

        :local parsedIp [:toip $targetAddress]
        :local ipParaTestar ""
        :local nomeExibicao $targetComment
        :local processar false

        :if ([:typeof $parsedIp] = "ip") do={
            :if ($isDynamic = false) do={
                :set ipParaTestar $targetAddress
                :set processar true
            }
        } else={
            :local dynEntry [/ip firewall address-list find list=$listName comment=$targetAddress dynamic=yes]
            :if ([:len $dynEntry] > 0) do={
                :set ipParaTestar [/ip firewall address-list get ($dynEntry->0) address]
                :set processar true
            }
        }

        :if ($processar = true) do={
            :if ([:len $nomeExibicao] = 0) do={ :set nomeExibicao $targetAddress }

            :local melhorLink ""
            :local melhorGw ""
            :local menorPerda 100
            :local menorRtt 999999
            :local linksDataJson ""

            :local rotaAtualId [/ip route find dst-address=($ipParaTestar . "/32") comment~"SDWAN_AUTO"]
            :local linkAtualName "PADRAO"
            :if ([:len $rotaAtualId] > 0) do={
                :local cmtAtual [/ip route get $rotaAtualId comment]
                :set linkAtualName [:pick $cmtAtual ([:find $cmtAtual "via "] + 4) [:len $cmtAtual]]
            }

            :for i from=0 to=([:len $linkNames] - 1) do={
                :local linkName ($linkNames->$i)
                :local ifaceName ($linkIfaces->$i)
                :local gw ($linkGws->$i)

                :local pings [/ping $ipParaTestar interface=$ifaceName count=$pingCount interval=$pingInterval as-value]
                :local totalNsec 0
                :local recebidos 0

                :foreach p in=$pings do={
                    :local t ($p->"time")
                    :if ([:typeof $t] = "time") do={
                        :set totalNsec ($totalNsec + [:tonsec $t])
                        :set recebidos ($recebidos + 1)
                    }
                }

                :local perda 100
                :local mediaRtt 999999
                :if ($recebidos > 0) do={
                    :set perda (100 - (($recebidos * 100) / $pingCount))
                    :set mediaRtt ($totalNsec / $recebidos / 1000000)
                    :if ($mediaRtt = 0) do={ :set mediaRtt 1 }
                }

                :local linkJson ("{\"link\":\"" . $linkName . "\",\"gw\":\"" . $gw . "\",\"perda\":" . $perda . ",\"rtt\":" . $mediaRtt . "}")
                :if ([:len $linksDataJson] > 0) do={
                    :set linksDataJson ($linksDataJson . "," . $linkJson)
                } else={
                    :set linksDataJson $linkJson
                }

                :if ($melhorLink = "") do={
                    :set melhorLink $linkName
                    :set melhorGw $gw
                    :set menorPerda $perda
                    :set menorRtt $mediaRtt
                } else={
                    :if ($perda < $menorPerda) do={
                        :set melhorLink $linkName
                        :set melhorGw $gw
                        :set menorPerda $perda
                        :set menorRtt $mediaRtt
                    } else={
                        :if ($perda = $menorPerda and $mediaRtt < $menorRtt) do={
                            :set melhorLink $linkName
                            :set melhorGw $gw
                            :set menorPerda $perda
                            :set menorRtt $mediaRtt
                        }
                    }
                }
            }

            :local houveTroca false
            :local flagTroca "false"
            :if ($linkAtualName != $melhorLink and $melhorGw != "") do={
                :set houveTroca true
                :set flagTroca "true"
                :do { /ip route remove [find dst-address=($ipParaTestar . "/32") comment~"SDWAN_AUTO"] } on-error={}
                /ip route add dst-address=($ipParaTestar . "/32") gateway=$melhorGw comment=("SDWAN_AUTO [" . $nomeExibicao . "] via " . $melhorLink)
                /log warning message=("[TRACERT+] Destino " . $nomeExibicao . " (" . $ipParaTestar . ") agora via [" . $melhorLink . "] - RTT: " . $menorRtt . "ms | Perda: " . $menorPerda . "%")
            }

            :local payload ("{\"token\":\"" . $routerToken . "\",\"roteador\":\"" . $foRouterName . "\",\"nomeDestino\":\"" . $nomeExibicao . "\",\"endereco\":\"" . $ipParaTestar . "\",\"linkAtivo\":\"" . $melhorLink . "\",\"linkAnterior\":\"" . $linkAtualName . "\",\"houveTroca\":" . $flagTroca . ",\"melhorRtt\":" . $menorRtt . ",\"melhorPerda\":" . $menorPerda . ",\"testes\":[" . $linksDataJson . "]}")
            :do {
                /tool fetch http-method=post http-header-field="Content-Type: application/json" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
            } on-error={
                /log error message=("[TRACERT+] Erro ao enviar telemetria para a API (" . $nomeExibicao . ")")
            }
        }
    }
}
/system scheduler remove [find name="executa_sdwan_monitor"]
/system scheduler add interval=1m name="executa_sdwan_monitor" on-event="sdwan_monitor" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
:log info message="[TRACERT+] Script sdwan_monitor v4.1 (v7) atualizado via OTA com sucesso!";
`;
}

function generateOtaSdwanScript(router) {
  if (isRouterOSv6(router)) {
    return generateOtaSdwanScriptV6(router);
  }
  return generateOtaSdwanScriptV7(router);
}

function generateFailoverScript(router) {
  return `# =======================================================================
# SCRIPT: FAILOVER_SETUP_AND_MONITOR (TRACERT+ OFICIAL v8 UNIVERSAL)
# Roteador: ${router.name}
# Token: ${router.token}
# Padrao: Rotas /ip route com comentario "LINK - OPERADORA"
# =======================================================================

# 1. Limpeza segura de regras anteriores
:do { /system script remove [find name="tracert_link_monitor"] } on-error={}
:do { /system scheduler remove [find name="executa_tracert_link_monitor"] } on-error={}
:foreach r in=[/ip route find comment~"!=="] do={ :do { /ip route remove $r } on-error={} }
:do { :foreach r in=[/routing rule find comment~"!=="] do={ :do { /routing rule remove $r } on-error={} } } on-error={}
:do { :foreach r in=[/ip route rule find comment~"!=="] do={ :do { /ip route rule remove $r } on-error={} } } on-error={}
:do { :foreach t in=[/routing table find name~"rota-de-teste"] do={ :do { /routing table remove $t } on-error={} } } on-error={}
:do { /system script remove [find name="failover"] } on-error={}
:do { /system script remove [find name="FAILOVER_ACTIONS"] } on-error={}
:do { /system scheduler remove [find name="executa script failover"] } on-error={}

# 2. Configura a acao FAILOVER_ACTIONS conectada ao TRACERT+
/system script add dont-require-permissions=no name="FAILOVER_ACTIONS" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :global foLinkName
    :global comentario
    :local linkFinal $foLinkName
    :if ([:len $linkFinal] = 0) do={ :set linkFinal $comentario }
    :local hashPos [:find $linkFinal "#"]
    :if ([:typeof $hashPos] = "num") do={ :set linkFinal [:pick $linkFinal 0 $hashPos] }

    :global foLinkStatus
    :global LinkStatus
    :global LinkState
    :local statusFinal $foLinkStatus
    :if ([:len $statusFinal] = 0) do={ :set statusFinal $LinkStatus }
    :if ([:len $statusFinal] = 0) do={
        :if ($LinkState > 0) do={ :set statusFinal "UP" } else={ :set statusFinal "DOWN" }
    }

    :global foPingScore
    :local scoreFinal $foPingScore
    :if ([:typeof $scoreFinal] != "num") do={
        :if ($statusFinal = "UP") do={ :set scoreFinal 8 } else={ :set scoreFinal 0 }
    }

    :local routerName [/system identity get name]
    /log warning message=("[FAILOVER] Link: " . $linkFinal . " alterado para: " . $statusFinal . " (Score: " . [:tostr $scoreFinal] . "/8)")

    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/failover"
    :local routerToken "${router.token}"
    :local payload ("token=" . $routerToken . "&link=" . $linkFinal . "&status=" . $statusFinal . "&score=" . [:tostr $scoreFinal])

    :do {
        /tool fetch check-certificate=no http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
    } on-error={
        :do {
            /tool fetch http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
        } on-error={
            /log error message=("[FAILOVER] Falha ao enviar telemetria para o TRACERT+ para " . $linkFinal)
        }
    }
}

# 3. Setup dinamico de tabelas e rotas de teste
:foreach i in=[/ip route find dst-address=0.0.0.0/0] do={
    :local cmt [/ip route get $i comment]
    :if ([:len $cmt] > 0 and ($cmt ~ "[Ll][Ii][Nn][Kk]") and !($cmt ~ "!==")) do={
        :local gw [/ip route get $i gateway]
        :local cleanName $cmt
        :local hashPos [:find $cmt "#"]
        :if ([:typeof $hashPos] = "num") do={
            :set cleanName [:pick $cmt 0 $hashPos]
        }

        :local safeCmt ""
        :for idx from=0 to=([:len $cleanName] - 1) do={
            :local char [:pick $cleanName $idx ($idx + 1)]
            :if ($char = " " or $char = "/" or $char = ":" or $char = "_") do={ :set char "-" }
            :set safeCmt ($safeCmt . $char)
        }

        :local tabName ("rota-de-teste-para-" . $safeCmt)

        :do {
            /routing table add name=$tabName fib
        } on-error={}

        :do {
            /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-table=$tabName comment=("!== Rota de teste para " . $cleanName)
        } on-error={
            :do { /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-mark=$tabName comment=("!== Rota de teste para " . $cleanName) } on-error={}
        }

        :do {
            /routing rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cleanName)
        } on-error={
            :do { /ip route rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cleanName) } on-error={}
        }
    }
}

# 4. Script de monitoramento de Failover
/system script add dont-require-permissions=no name="failover" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local IPsParaTeste [:toarray "8.8.8.8,8.8.4.4,200.160.0.8,31.13.80.8"]
    :local NumeroDePings 2
    :local Intervalo 00:00:00.5
    :local ScoreMinimoUP 3

    :global foRouterName [/system identity get name]
    :global foLinkName
    :global foLinkStatus
    :global foPingScore
    :global comentario
    :global LinkStatus
    :global LinkState

    :local totalRotasAtivas 0
    :foreach i in=[/ip route find dst-address=0.0.0.0/0 disabled=no] do={
        :local cmt [/ip route get $i comment]
        :if ([:len $cmt] > 0 and ($cmt ~ "[Ll][Ii][Nn][Kk]") and !($cmt ~ "!==")) do={
            :set totalRotasAtivas ($totalRotasAtivas + 1)
        }
    }

    :foreach i in=[/ip route find dst-address=0.0.0.0/0] do={
        :local cmt [/ip route get $i comment]
        :if ([:len $cmt] > 0 and ($cmt ~ "[Ll][Ii][Nn][Kk]") and !($cmt ~ "!==")) do={
            :local cleanName $cmt
            :local hashPos [:find $cmt "#"]
            :if ([:typeof $hashPos] = "num") do={
                :set cleanName [:pick $cmt 0 $hashPos]
            }

            :local safeCmt ""
            :for idx from=0 to=([:len $cleanName] - 1) do={
                :local char [:pick $cleanName $idx ($idx + 1)]
                :if ($char = " " or $char = "/" or $char = ":" or $char = "_") do={ :set char "-" }
                :set safeCmt ($safeCmt . $char)
            }
            :local TabRoteAtual ("rota-de-teste-para-" . $safeCmt)

            :local scoreAtual 0
            :local rGw [/ip route get $i gateway]
            :local ifaceName $rGw
            :do {
                :local immGw [/ip route get $i immediate-gw]
                :local pctPos [:find $immGw "%"]
                :if ([:typeof $pctPos] = "num") do={
                    :set ifaceName [:pick $immGw ($pctPos + 1) [:len $immGw]]
                }
            } on-error={}

            :foreach ip in=$IPsParaTeste do={
                :local res 0
                :do {
                    :set res [/ping $ip count=$NumeroDePings interval=$Intervalo routing-table=$TabRoteAtual]
                } on-error={
                    :do {
                        :set res [/ping $ip count=$NumeroDePings interval=$Intervalo interface=$ifaceName]
                    } on-error={ :set res 0 }
                }
                :set scoreAtual ($scoreAtual + $res)
            }

            :local isDis [/ip route get $i disabled]

            # SE O LINK FALHOU (score < ScoreMinimoUP) e a rota estava ATIVA (disabled=no)
            :if ($scoreAtual < $ScoreMinimoUP and $isDis = false) do={
                :if ($totalRotasAtivas > 1) do={
                    /ip route set $i disabled=yes
                    :set totalRotasAtivas ($totalRotasAtivas - 1)
                    :set foLinkName $cleanName
                    :set foLinkStatus "DOWN"
                    :set foPingScore $scoreAtual
                    :set comentario $cleanName
                    :set LinkStatus "DOWN"
                    :set LinkState 0
                    :do { /system script run FAILOVER_ACTIONS } on-error={}
                } else={
                    /log warning message=("[FAILOVER] Link " . $cleanName . " falhou (Score " . [:tostr $scoreAtual] . "/8), mantido ativo por ser o unico restante!")
                    :set foLinkName $cleanName
                    :set foLinkStatus "DOWN"
                    :set foPingScore $scoreAtual
                    :set comentario $cleanName
                    :set LinkStatus "DOWN"
                    :set LinkState 0
                    :do { /system script run FAILOVER_ACTIONS } on-error={}
                }
            }

            # SE O LINK RECUPEROU (score >= ScoreMinimoUP) e a rota estava DESATIVADA (disabled=yes)
            :if ($scoreAtual >= $ScoreMinimoUP and $isDis = true) do={
                /ip route set $i disabled=no
                :set totalRotasAtivas ($totalRotasAtivas + 1)
                :set foLinkName $cleanName
                :set foLinkStatus "UP"
                :set foPingScore $scoreAtual
                :set comentario $cleanName
                :set LinkStatus "UP"
                :set LinkState 1
                :do { /system script run FAILOVER_ACTIONS } on-error={}
            }
        }
    }
}

# 5. Agendador (a cada 30 segundos)
/system scheduler remove [find name="executa script failover"]
/system scheduler add interval=30s name="executa script failover" on-event="failover" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# Executa imediatamente a primeira checagem para publicar os links
:do { /system script run failover } on-error={}
:log info message="[TRACERT+] Failover Multi-Link v8 provisionado e sincronizado!";
`;
}

function generateBootstrapScript(router) {
  return `# =======================================================================
# SCRIPT DE ATIVACAO TRACERT+ (UNIVERSAL v6 / v7)
# Roteador: ${router.name}
# Token: ${router.token}
# =======================================================================

# 0. Garante que o MikroTik consiga resolver DNS se estiver zerado
:do {
    :local currentDns [/ip dns get servers]
    :if ([:len $currentDns] = 0) do={
        /ip dns set servers=1.1.1.1,8.8.8.8
    }
} on-error={}

# 1. Configura Agente de Sincronizacao Remota e OTA (Modelo 2)
/system script remove [find name="tracert_sync"]
/system script add dont-require-permissions=no name="tracert_sync" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source=":local syncUrl \"https://tracert.tiplus.inf.br/api/routers/sync/${router.token}\"
\

:do {
\

    /tool fetch check-certificate=no url=\$syncUrl dst-path=\"tracert_sync.rsc\" keep-result=yes
\

    :local f [/file find name=\"tracert_sync.rsc\"]
\

    :if ([:len \$f] > 0) do={
\

        :local sz [/file get \$f size]
\

        :if (\$sz > 45) do={
\

            /import file-name=\"tracert_sync.rsc\"
\

            /log info message=\"[TRACERT+] Comandos OTA sincronizados e executados com sucesso!\"
\

        }
\

        /file remove [find name=\"tracert_sync.rsc\"]
\

    }
\

} on-error={}
\

"
/system scheduler remove [find name="executa_tracert_sync"]
/system scheduler add interval=1m name="executa_tracert_sync" on-event="tracert_sync" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 2. Configura Monitor de Link WAN e Heartbeat (Captura comentário LINK - OPERADORA)
/system script remove [find name="tracert_link_monitor"]
/system script add dont-require-permissions=no name="tracert_link_monitor" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source="# Busca o link de operadora pelo padrao de comentario
\

:local linkName \"\"
\

:foreach r in=[/ip route find dst-address=0.0.0.0/0] do={
\

    :local cmt [/ip route get \$r comment]
\

    :if ([:len \$cmt] > 0 and (\$cmt ~ \"[Ll][Ii][Nn][Kk]\") and !(\$cmt ~ \"!==\")) do={
\

        :local hashPos [:find \$cmt \"#\"]
\

        :if ([:typeof \$hashPos] = \"num\") do={ :set cmt [:pick \$cmt 0 \$hashPos] }
\

        :set linkName \$cmt
\

    }
\

}
\

:if (\$linkName = \"\") do={ :set linkName \"LINK - PRINCIPAL\" }
\

:local pings [/ping 8.8.8.8 count=2 interval=00:00:00.5]
\

:local score 8
\

:local st \"UP\"
\

:if (\$pings = 0) do={ :set score 0; :set st \"DOWN\" }
\

:local payload (\"token=${router.token}&link=\" . \$linkName . \"&status=\" . \$st . \"&score=\" . [:tostr \$score])
\

:do {
\

    /tool fetch check-certificate=no http-method=post http-header-field=\"Content-Type: application/x-www-form-urlencoded\" url=\"https://tracert.tiplus.inf.br/api/telemetry/failover/${router.token}\" http-data=\$payload keep-result=no
\

} on-error={}
\

"
/system scheduler remove [find name="executa_tracert_link_monitor"]
/system scheduler add interval=1m name="executa_tracert_link_monitor" on-event="tracert_link_monitor" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 3. Configura Agente de Telemetria de Hardware & Sistema
/system script remove [find name="tracert_system_telemetry"]
/system script add dont-require-permissions=no name="tracert_system_telemetry" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source=":local resModel [/system resource get board-name]
\

:local resVersion [/system resource get version]
\

:local resCpu [/system resource get cpu]
\

:local resCpuCount [:tostr [/system resource get cpu-count]]
\

:local resCpuLoad [:tostr [/system resource get cpu-load]]
\

:local resTotalMem [:tostr ([/system resource get total-memory] / 1048576)]
\

:local resFreeMem [:tostr ([/system resource get free-memory] / 1048576)]
\

:local resUptime [:tostr [/system resource get uptime]]
\

:local rbFirmware \"N/A\"
\

:local rbSerial \"N/A\"
\

:do {
\

    :set rbFirmware [/system routerboard get current-firmware]
\

    :set rbSerial [/system routerboard get serial-number]
\

} on-error={}
\

:local payload (\"token=${router.token}&model=\" . \$resModel . \"&routerosVersion=\" . \$resVersion . \"&firmwareVersion=\" . \$rbFirmware . \"&cpuModel=\" . \$resCpu . \"&cpuCount=\" . \$resCpuCount . \"&cpuLoad=\" . \$resCpuLoad . \"&totalMemory=\" . \$resTotalMem . \"&freeMemory=\" . \$resFreeMem . \"&uptime=\" . \$resUptime . \"&serialNumber=\" . \$rbSerial)
\

:do {
\

    /tool fetch check-certificate=no http-method=post http-header-field=\"Content-Type: application/x-www-form-urlencoded\" url=\"https://tracert.tiplus.inf.br/api/telemetry/system/${router.token}\" http-data=\$payload keep-result=no
\

    /log info message=(\"[TRACERT+] Telemetria de hardware enviada com sucesso!\")
\

} on-error={
\

    /log error message=(\"[TRACERT+] Falha ao enviar telemetria de hardware\")
\

}
\

"
/system scheduler remove [find name="executa_tracert_telemetria_sistema"]
/system scheduler add interval=1h name="executa_tracert_telemetria_sistema" on-event="tracert_system_telemetry" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 4. Dispara primeira coleta e sincronizacao imediata
:do { /system script run tracert_link_monitor } on-error={}
:do { /system script run tracert_system_telemetry } on-error={}
:do { /system script run tracert_sync } on-error={}

:log info message="[TRACERT+] Roteador conectado e provisionado no TRACERT+ com sucesso!";
`;
}

// Endpoint de download direto do bootstrap script (raw text para o 1-liner /tool fetch)
app.get(['/api/routers/bootstrap/:token', '/api/routers/bootstrap/:token/script.rsc'], (req, res) => {
  const router = getRouterByToken(req.params.token);
  if (!router) return res.status(404).send('# [TRACERT+] Roteador nao encontrado' + String.fromCharCode(10));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(generateBootstrapScript(router));
});

app.get('/api/routers/:id/bootstrap', authMiddleware, (req, res) => {
  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);
  if (!router) return res.status(404).json({ error: 'Roteador não encontrado' });

  const script = generateBootstrapScript(router);
  res.json({ router, script });
});

app.get('/api/routers/:id/commands', authMiddleware, (req, res) => {
  const routerId = req.params.id;
  const commands = db.prepare('SELECT * FROM router_commands WHERE router_id = ? ORDER BY id DESC LIMIT 50').all(routerId);
  res.json(commands);
});

app.post('/api/routers/:id/commands', authMiddleware, adminOnly, (req, res) => {
  const routerId = req.params.id;
  const { command, name, type } = req.body;
  if (!command) return res.status(400).json({ error: 'Comando obrigatorio' });

  const result = enqueueCommand(routerId, type || 'RAW_SCRIPT', name || 'Comando Manual', command);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.post('/api/routers/:id/sync-targets', authMiddleware, adminOnly, (req, res) => {
  const routerId = req.params.id;
  const script = generateSyncTargetsScript(routerId);
  const result = enqueueCommand(routerId, 'SYNC_TARGETS', 'Sincronizar Destinos SD-WAN', script);
  res.json({ success: true, message: 'Comando de sincronizacao enfileirado para o roteador', id: result.lastInsertRowid });
});

app.post('/api/routers/:id/failover', authMiddleware, adminOnly, (req, res) => {
  const routerId = req.params.id;
  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId);
  if (!router) return res.status(404).json({ error: 'Roteador não encontrado' });

  const script = generateFailoverScript(router);
  const result = enqueueCommand(router.id, 'FAILOVER_SETUP', 'Provisionamento Failover Multi-Link (Bendito v8)', script);
  res.json({ success: true, message: 'Script de Failover enfileirado com sucesso para a RB!', id: result.lastInsertRowid });
});

app.get('/api/routers/:id/failover-script', authMiddleware, (req, res) => {
  const routerId = req.params.id;
  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId);
  if (!router) return res.status(404).json({ error: 'Roteador não encontrado' });

  const script = generateFailoverScript(router);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(script);
});

app.post('/api/routers/:id/ota-update', authMiddleware, adminOnly, (req, res) => {
  const routerId = req.params.id;
  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId);
  if (!router) return res.status(404).json({ error: 'Roteador nao encontrado' });

  const script = generateOtaSdwanScript(router);
  const result = enqueueCommand(router.id, 'OTA_SDWAN', 'Atualizacao OTA Script SD-WAN v4.1', script);
  res.json({ success: true, message: 'Atualizacao OTA do script enfileirada com sucesso!', id: result.lastInsertRowid });
});

app.delete('/api/commands/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM router_commands WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Relatórios
app.get('/api/reports/availability', authMiddleware, (req, res) => {
  const { routerId, startDate, endDate } = req.query;
  const sDate = startDate ? `${startDate} 00:00:00` : '1970-01-01 00:00:00';
  const eDate = endDate ? `${endDate} 23:59:59` : '2099-12-31 23:59:59';

  let outagesQuery = `
    SELECT o.*, r.name as router_name
    FROM link_outages o
    JOIN routers r ON r.id = o.router_id
  `;
  const params = [];
  if (req.user.role !== 'ADMIN') {
    outagesQuery += ' JOIN group_routers gr ON gr.router_id = r.id WHERE gr.group_id = ? AND o.down_time BETWEEN ? AND ?';
    params.push(req.user.groupId, sDate, eDate);
  } else {
    outagesQuery += ' WHERE o.down_time BETWEEN ? AND ?';
    params.push(sDate, eDate);
  }

  if (routerId) {
    outagesQuery += ' AND o.router_id = ?';
    params.push(routerId);
  }
  outagesQuery += ' ORDER BY o.down_time DESC';

  const outages = db.prepare(outagesQuery).all(...params);

  const stats = {};
  for (const o of outages) {
    if (!stats[o.link_name]) {
      stats[o.link_name] = { link: o.link_name, totalQuedas: 0, segundosOffline: 0 };
    }
    stats[o.link_name].totalQuedas += 1;
    stats[o.link_name].segundosOffline += (o.duration_seconds || 0);
  }

  res.json({ outages, stats: Object.values(stats) });
});

app.get('/api/reports/sdwan', authMiddleware, (req, res) => {
  const { routerId, startDate, endDate } = req.query;
  const sDate = startDate ? `${startDate} 00:00:00` : '1970-01-01 00:00:00';
  const eDate = endDate ? `${endDate} 23:59:59` : '2099-12-31 23:59:59';

  let query = `
    SELECT h.*, t.name as target_name, t.address as target_address, r.name as router_name
    FROM sdwan_history h
    JOIN sdwan_targets t ON t.id = h.target_id
    JOIN routers r ON r.id = t.router_id
  `;
  const params = [];
  if (req.user.role !== 'ADMIN') {
    query += ' JOIN group_routers gr ON gr.router_id = r.id WHERE gr.group_id = ? AND h.started_at BETWEEN ? AND ?';
    params.push(req.user.groupId, sDate, eDate);
  } else {
    query += ' WHERE h.started_at BETWEEN ? AND ?';
    params.push(sDate, eDate);
  }

  if (routerId) {
    query += ' AND r.id = ?';
    params.push(routerId);
  }
  query += ' ORDER BY h.started_at DESC';

  const history = db.prepare(query).all(...params);
  res.json(history);
});

// Grupos CRUD
app.get('/api/admin/groups', authMiddleware, adminOnly, (req, res) => {
  const groups = db.prepare('SELECT * FROM access_groups ORDER BY name ASC').all();
  const getRouters = db.prepare('SELECT router_id FROM group_routers WHERE group_id = ?');
  const enriched = groups.map(g => ({
    ...g,
    routerIds: getRouters.all(g.id).map(r => r.router_id)
  }));
  res.json(enriched);
});

app.get('/api/admin/groups/:id', authMiddleware, adminOnly, (req, res) => {
  const group = db.prepare('SELECT * FROM access_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
  const routerIds = db.prepare('SELECT router_id FROM group_routers WHERE group_id = ?').all(group.id).map(r => r.router_id);
  res.json({ ...group, routerIds });
});

app.post('/api/admin/groups', authMiddleware, adminOnly, (req, res) => {
  const { name, whatsappNumber, notifyLinkDown, notifySdwanSwitch, notifyRouterOffline, routerIds } = req.body;
  let cleanPhone = (whatsappNumber || '').replace(/\D/g, '');
  if (cleanPhone && !cleanPhone.startsWith('55')) cleanPhone = '55' + cleanPhone;

  const result = db.prepare(`
    INSERT INTO access_groups (name, whatsapp_number, notify_link_down, notify_sdwan_switch, notify_router_offline)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, cleanPhone, notifyLinkDown ? 1 : 0, notifySdwanSwitch ? 1 : 0, notifyRouterOffline ? 1 : 0);

  const groupId = result.lastInsertRowid;
  if (Array.isArray(routerIds)) {
    const insertGR = db.prepare('INSERT INTO group_routers (group_id, router_id) VALUES (?, ?)');
    for (const rId of routerIds) {
      insertGR.run(groupId, rId);
    }
  }
  res.json({ id: groupId, success: true });
});

app.put('/api/admin/groups/:id', authMiddleware, adminOnly, (req, res) => {
  const groupId = req.params.id;
  const { name, whatsappNumber, notifyLinkDown, notifySdwanSwitch, notifyRouterOffline, routerIds } = req.body;
  let cleanPhone = (whatsappNumber || '').replace(/\D/g, '');
  if (cleanPhone && !cleanPhone.startsWith('55')) cleanPhone = '55' + cleanPhone;

  db.prepare(`
    UPDATE access_groups SET
      name = ?,
      whatsapp_number = ?,
      notify_link_down = ?,
      notify_sdwan_switch = ?,
      notify_router_offline = ?
    WHERE id = ?
  `).run(name, cleanPhone, notifyLinkDown ? 1 : 0, notifySdwanSwitch ? 1 : 0, notifyRouterOffline ? 1 : 0, groupId);

  db.prepare('DELETE FROM group_routers WHERE group_id = ?').run(groupId);
  if (Array.isArray(routerIds)) {
    const insertGR = db.prepare('INSERT INTO group_routers (group_id, router_id) VALUES (?, ?)');
    for (const rId of routerIds) {
      insertGR.run(groupId, rId);
    }
  }
  res.json({ success: true });
});

app.delete('/api/admin/groups/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM access_groups WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Usuários CRUD
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.username, u.role, u.group_id, u.inactivity_timeout_min, u.created_at, g.name as group_name
    FROM users u
    LEFT JOIN access_groups g ON g.id = u.group_id
    ORDER BY u.name ASC
  `).all();
  res.json(users);
});

app.get('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  const user = db.prepare('SELECT id, name, username, role, group_id, inactivity_timeout_min FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(user);
});

app.post('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const { name, username, password, role, groupId, timeoutMinutes } = req.body;
  const hash = bcrypt.hashSync(password || '123456', 10);
  try {
    const result = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, group_id, inactivity_timeout_min)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, username, hash, role || 'USER', groupId || null, timeoutMinutes || 15);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(400).json({ error: 'Nome de usuário já existe' });
  }
});

app.put('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  const userId = req.params.id;
  const { name, username, password, role, groupId, timeoutMinutes } = req.body;

  try {
    if (password && password.trim() !== '') {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare(`
        UPDATE users SET
          name = ?,
          username = ?,
          password_hash = ?,
          role = ?,
          group_id = ?,
          inactivity_timeout_min = ?
        WHERE id = ?
      `).run(name, username, hash, role || 'USER', groupId || null, timeoutMinutes || 15, userId);
    } else {
      db.prepare(`
        UPDATE users SET
          name = ?,
          username = ?,
          role = ?,
          group_id = ?,
          inactivity_timeout_min = ?
        WHERE id = ?
      `).run(name, username, role || 'USER', groupId || null, timeoutMinutes || 15, userId);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Erro ao atualizar usuário' });
  }
});

app.delete('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  if (parseInt(req.params.id, 10) === req.user.id) {
    return res.status(400).json({ error: 'Você não pode excluir o seu próprio usuário logado' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Evolution Config
app.get('/api/admin/evolution', authMiddleware, adminOnly, (req, res) => {
  const config = db.prepare('SELECT * FROM evolution_config WHERE id = 1').get();
  res.json(config || {});
});

app.post('/api/admin/evolution', authMiddleware, adminOnly, (req, res) => {
  const { baseUrl, apiKey, instanceName, enabled } = req.body;
  db.prepare(`
    INSERT INTO evolution_config (id, base_url, api_key, instance_name, enabled, updated_at)
    VALUES (1, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      instance_name = excluded.instance_name,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run(baseUrl, apiKey, instanceName, enabled ? 1 : 0);
  res.json({ success: true });
});

// Watcher Roteadores Offline (dispara apenas uma única vez na queda e não repete)
setInterval(() => {
  try {
    const offlineRouters = db.prepare(`
      SELECT r.* FROM routers r
      WHERE datetime(r.last_seen, '+5 minutes') < datetime('now')
        AND (r.offline_notified IS NULL OR r.offline_notified = 0)
    `).all();

    for (const r of offlineRouters) {
      db.prepare("UPDATE routers SET offline_notified = 1 WHERE id = ?").run(r.id);
      const msg = `⚠️ *TRACERT+: MIKROTIK OFFLINE*\n\n📍 *Roteador:* ${r.name}\n❌ *Status:* Sem telemetria há mais de 5 minutos!\n⏰ *Último contato:* ${r.last_seen || 'Nunca'}`;
      sendEvolutionWhatsapp('ROUTER_OFFLINE', r.id, msg);
    }
  } catch (e) {
    console.error('[Watcher Offline] Erro:', e);
  }
}, 60000);


// ----------------------------------------------------------------------
// CENTRAL DE COMANDOS EM MASSA / BROADCAST OTA
// ----------------------------------------------------------------------
app.post('/api/admin/commands/broadcast', authMiddleware, adminOnly, (req, res) => {
  const { targetFilter, selectedRouterIds, commandName, script } = req.body;
  if (!script || !script.trim()) {
    return res.status(400).json({ error: 'O script/comando não pode estar vazio.' });
  }

  let routers = [];
  if (targetFilter === 'ALL') {
    routers = db.prepare('SELECT * FROM routers').all();
  } else if (targetFilter === 'SDWAN_ONLY') {
    routers = db.prepare('SELECT * FROM routers WHERE has_sdwan = 1 OR has_sdwan IS NULL').all();
  } else if (targetFilter === 'SINGLE_LINK') {
    routers = db.prepare('SELECT * FROM routers WHERE has_sdwan = 0').all();
  } else if (targetFilter === 'ROS_V7') {
    routers = db.prepare("SELECT * FROM routers WHERE routeros_version LIKE '7%' OR routeros_version LIKE '% 7%'").all();
  } else if (targetFilter === 'ROS_V6') {
    routers = db.prepare("SELECT * FROM routers WHERE routeros_version LIKE '6%' OR routeros_version LIKE '% 6%'").all();
  } else if (targetFilter === 'SELECTED') {
    if (!Array.isArray(selectedRouterIds) || selectedRouterIds.length === 0) {
      return res.status(400).json({ error: 'Selecione pelo menos um MikroTik.' });
    }
    const placeholders = selectedRouterIds.map(() => '?').join(',');
    routers = db.prepare(`SELECT * FROM routers WHERE id IN (${placeholders})`).all(...selectedRouterIds);
  } else {
    routers = db.prepare('SELECT * FROM routers').all();
  }

  if (routers.length === 0) {
    return res.status(400).json({ error: 'Nenhum MikroTik encontrado com os filtros selecionados.' });
  }

  const batchId = 'BATCH-' + Date.now().toString(36).toUpperCase();
  const cmdName = (commandName && commandName.trim()) ? commandName.trim() : 'Comando em Massa';
  const insertCmd = db.prepare(`
    INSERT INTO router_commands (router_id, command_type, command_name, payload, status, batch_id)
    VALUES (?, 'RAW_SCRIPT', ?, ?, 'PENDING', ?)
  `);

  for (const r of routers) {
    // Substitui automaticamente tokens genéricos pelo token exclusivo de cada RB
    const personalizedScript = script
      .replace(/SEU_TOKEN_AQUI/g, r.token)
      .replace(/TOKEN_DO_ROTEADOR/g, r.token)
      .replace(/MK-TOKEN-AQUI/g, r.token);
    insertCmd.run(r.id, cmdName, personalizedScript, batchId);
  }

  res.json({
    success: true,
    batchId,
    totalQueued: routers.length,
    routers: routers.map(r => ({ id: r.id, name: r.name }))
  });
});

app.get('/api/admin/commands/batches', authMiddleware, adminOnly, (req, res) => {
  const batches = db.prepare(`
    SELECT 
      rc.batch_id,
      rc.command_name,
      rc.payload,
      MIN(rc.created_at) as created_at,
      COUNT(rc.id) as total_routers,
      SUM(CASE WHEN rc.status = 'EXECUTED' THEN 1 ELSE 0 END) as executed_count,
      SUM(CASE WHEN rc.status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN rc.status = 'FETCHED' THEN 1 ELSE 0 END) as fetched_count,
      SUM(CASE WHEN rc.status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count
    FROM router_commands rc
    WHERE rc.batch_id IS NOT NULL
    GROUP BY rc.batch_id
    ORDER BY MIN(rc.id) DESC
    LIMIT 30
  `).all();
  res.json(batches);
});

app.get('/api/admin/commands/batches/:batchId', authMiddleware, adminOnly, (req, res) => {
  const batchId = req.params.batchId;
  const items = db.prepare(`
    SELECT 
      rc.id, rc.status, rc.created_at, rc.fetched_at, rc.executed_at, rc.result_log,
      r.id as router_id, r.name as router_name, r.model, r.routeros_version, r.has_sdwan,
      c.name as client_name
    FROM router_commands rc
    JOIN routers r ON r.id = rc.router_id
    JOIN clients c ON c.id = r.client_id
    WHERE rc.batch_id = ?
    ORDER BY r.name ASC
  `).all(batchId);
  res.json(items);
});

app.post('/api/admin/commands/batches/:batchId/cancel', authMiddleware, adminOnly, (req, res) => {
  const batchId = req.params.batchId;
  const result = db.prepare(`
    UPDATE router_commands SET status = 'CANCELLED' WHERE batch_id = ? AND status = 'PENDING'
  `).run(batchId);
  res.json({ success: true, cancelled: result.changes });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Tracert+] Servidor ativo na porta ${PORT}`);
});
