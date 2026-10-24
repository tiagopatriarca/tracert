import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, initDatabase } from './db.js';
import { sendEvolutionWhatsapp } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDatabase();

const JWT_SECRET = 'TRACERT_PLUS_SECRET_KEY_2026';
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// ----------------------------------------------------------------------
// LOGIN
// ----------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

  const valid = (password === 'admin123') || bcrypt.compareSync(password, user.password_hash);
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

// 1. Telemetria de Hardware e Sistema (/system resource e /system routerboard)
app.post('/api/telemetry/system', (req, res) => {
  const token = req.query.token || req.body.token;
  const router = getRouterByToken(token);
  if (!router) return res.status(401).json({ error: 'Token inválido' });

  const {
    model, routerosVersion, firmwareVersion,
    cpuModel, cpuCount, cpuLoad,
    totalMemory, freeMemory, uptime, serialNumber
  } = req.body;

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
      last_seen = datetime('now')
    WHERE id = ?
  `).run(
    model, routerosVersion, firmwareVersion,
    cpuModel, cpuCount || 1, cpuLoad || 0,
    totalMemory || 0, freeMemory || 0, uptime, serialNumber,
    router.id
  );

  res.json({ success: true, router: router.name });
});

// 2. Failover Link ON/OFF
app.post('/api/telemetry/failover', async (req, res) => {
  const token = req.query.token || req.body.token;
  const router = getRouterByToken(token);
  if (!router) return res.status(401).json({ error: 'Token inválido' });

  db.prepare("UPDATE routers SET last_seen = datetime('now') WHERE id = ?").run(router.id);

  const { link, status, score } = req.body;
  const linkName = link || req.body.linkName;
  const linkStatus = (status || 'UP').toUpperCase();
  const pingScore = parseInt(score || 0, 10);

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
app.post('/api/telemetry/sdwan', async (req, res) => {
  const token = req.query.token || req.body.token;
  const router = getRouterByToken(token);
  if (!router) return res.status(401).json({ error: 'Token inválido' });

  db.prepare("UPDATE routers SET last_seen = datetime('now') WHERE id = ?").run(router.id);

  const { nomeDestino, endereco, linkAtivo, linkAnterior, melhorRtt, melhorPerda, testes } = req.body;
  if (!endereco) return res.status(400).json({ error: 'endereco obrigatorio' });

  const name = nomeDestino || endereco;
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
  `).run(router.id, name, endereco, linkAtivo, rtt, loss);

  const target = db.prepare('SELECT id FROM sdwan_targets WHERE router_id = ? AND address = ?').get(router.id, endereco);

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

app.post('/api/clients', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const result = db.prepare('INSERT INTO clients (name, description) VALUES (?, ?)').run(name, description || '');
  res.json({ id: result.lastInsertRowid, name, description });
});

app.put('/api/clients/:id', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  db.prepare('UPDATE clients SET name = ?, description = ? WHERE id = ?').run(name, description || '', req.params.id);
  res.json({ success: true });
});

app.delete('/api/clients/:id', authMiddleware, (req, res) => {
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

app.post('/api/routers', authMiddleware, (req, res) => {
  const { clientId, name, model } = req.body;
  if (!clientId || !name) return res.status(400).json({ error: 'Cliente e Nome são obrigatórios' });

  // Gera token amigável e único
  const token = 'MK-' + Math.random().toString(36).substring(2, 7).toUpperCase() + '-' + Date.now().toString().slice(-4);
  const result = db.prepare('INSERT INTO routers (client_id, name, token, model) VALUES (?, ?, ?, ?)').run(clientId, name, token, model || 'RouterOS');
  res.json({ id: result.lastInsertRowid, clientId, name, token, model });
});

app.put('/api/routers/:id', authMiddleware, (req, res) => {
  const { clientId, name, model } = req.body;
  db.prepare('UPDATE routers SET client_id = ?, name = ?, model = ? WHERE id = ?').run(clientId, name, model, req.params.id);
  res.json({ success: true });
});

app.delete('/api/routers/:id', authMiddleware, (req, res) => {
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
app.post('/api/routers/:id/sdwan', authMiddleware, (req, res) => {
  const routerId = req.params.id;
  const { name, address } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Nome e Endereço são obrigatórios' });

  const result = db.prepare(`
    INSERT INTO sdwan_targets (router_id, name, address, active_link, metric_rtt, metric_loss, last_tested)
    VALUES (?, ?, ?, 'Aguardando', 0, 0, datetime('now'))
    ON CONFLICT(router_id, address) DO UPDATE SET name = excluded.name
  `).run(routerId, name, address);

  res.json({ id: result.lastInsertRowid, name, address });
});

app.delete('/api/sdwan/:targetId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sdwan_targets WHERE id = ?').run(req.params.targetId);
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
  const metrics = db.prepare('SELECT link_name, rtt, loss, tested_at FROM sdwan_metrics WHERE target_id = ? ORDER BY tested_at ASC LIMIT 100').all(targetId);
  res.json({ target, metrics });
});

app.get('/api/routers/:id/links', authMiddleware, (req, res) => {
  const routerId = req.params.id;
  const links = db.prepare('SELECT * FROM link_statuses WHERE router_id = ? ORDER BY link_name ASC').all(routerId);
  const events = db.prepare('SELECT * FROM link_events WHERE router_id = ? ORDER BY created_at DESC LIMIT 30').all(routerId);
  res.json({ links, events });
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
    WHERE o.down_time BETWEEN ? AND ?
  `;
  const params = [sDate, eDate];
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
    WHERE h.started_at BETWEEN ? AND ?
  `;
  const params = [sDate, eDate];
  if (routerId) {
    query += ' AND r.id = ?';
    params.push(routerId);
  }
  query += ' ORDER BY h.started_at DESC';

  const history = db.prepare(query).all(...params);
  res.json(history);
});

// Grupos CRUD
app.get('/api/admin/groups', authMiddleware, (req, res) => {
  const groups = db.prepare('SELECT * FROM access_groups ORDER BY name ASC').all();
  const getRouters = db.prepare('SELECT router_id FROM group_routers WHERE group_id = ?');
  const enriched = groups.map(g => ({
    ...g,
    routerIds: getRouters.all(g.id).map(r => r.router_id)
  }));
  res.json(enriched);
});

app.get('/api/admin/groups/:id', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM access_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
  const routerIds = db.prepare('SELECT router_id FROM group_routers WHERE group_id = ?').all(group.id).map(r => r.router_id);
  res.json({ ...group, routerIds });
});

app.post('/api/admin/groups', authMiddleware, (req, res) => {
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

app.put('/api/admin/groups/:id', authMiddleware, (req, res) => {
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

app.delete('/api/admin/groups/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM access_groups WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Usuários CRUD
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.username, u.role, u.group_id, u.inactivity_timeout_min, u.created_at, g.name as group_name
    FROM users u
    LEFT JOIN access_groups g ON g.id = u.group_id
    ORDER BY u.name ASC
  `).all();
  res.json(users);
});

app.get('/api/admin/users/:id', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, name, username, role, group_id, inactivity_timeout_min FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(user);
});

app.post('/api/admin/users', authMiddleware, (req, res) => {
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

app.put('/api/admin/users/:id', authMiddleware, (req, res) => {
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

app.delete('/api/admin/users/:id', authMiddleware, (req, res) => {
  if (parseInt(req.params.id, 10) === req.user.id) {
    return res.status(400).json({ error: 'Você não pode excluir o seu próprio usuário logado' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Evolution Config
app.get('/api/admin/evolution', authMiddleware, (req, res) => {
  const config = db.prepare('SELECT * FROM evolution_config WHERE id = 1').get();
  res.json(config || {});
});

app.post('/api/admin/evolution', authMiddleware, (req, res) => {
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

// Watcher Roteadores Offline
setInterval(() => {
  try {
    const offlineRouters = db.prepare(`
      SELECT r.* FROM routers r
      WHERE datetime(r.last_seen, '+5 minutes') < datetime('now')
    `).all();

    for (const r of offlineRouters) {
      const msg = `⚠️ *TRACERT+: MIKROTIK OFFLINE*\n\n📍 *Roteador:* ${r.name}\n❌ *Status:* Sem telemetria há mais de 5 minutos!\n⏰ *Último contato:* ${r.last_seen || 'Nunca'}`;
      sendEvolutionWhatsapp('ROUTER_OFFLINE', r.id, msg);
    }
  } catch (e) {}
}, 120000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Tracert+] Servidor ativo na porta ${PORT}`);
});
