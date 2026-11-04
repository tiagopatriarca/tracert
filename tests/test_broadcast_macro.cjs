const assert = require('assert');
const path = require('path');
const fs = require('fs');

const testDataDir = path.join(__dirname, 'test_broadcast_data');
process.env.DATA_DIR = testDataDir;

if (fs.existsSync(testDataDir)) {
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch (e) {}
}
fs.mkdirSync(testDataDir, { recursive: true });

const { db, initDatabase } = require('../db');
initDatabase();

console.log('[TEST] 1. Criando roteadores para teste de broadcast...');
const clientRes = db.prepare("INSERT INTO clients (name) VALUES ('Cliente Broadcast')").run();
const clientId = clientRes.lastInsertRowid;

const r1 = db.prepare("INSERT INTO routers (client_id, name, token) VALUES (?, 'RB Matriz', 'MK-MATRIZ-1111')").run(clientId);
const r2 = db.prepare("INSERT INTO routers (client_id, name, token) VALUES (?, 'RB Filial', 'MK-FILIAL-2222')").run(clientId);

console.log('[TEST] 2. Simulando broadcast com macros {{TOKEN}} e {{ROUTER_NAME}}...');
const rawScriptTemplate = `# Atualizacao {{ROUTER_NAME}}\r\n/tool fetch url="https://tracert.tiplus.inf.br/api/routers/bootstrap/{{TOKEN}}/script.rsc"\r\n# ID {{ROUTER_ID}}`;

const routers = db.prepare('SELECT * FROM routers WHERE id IN (?, ?)').all(r1.lastInsertRowid, r2.lastInsertRowid);
const insertCmd = db.prepare(`
  INSERT INTO router_commands (router_id, command_type, command_name, payload, status, batch_id)
  VALUES (?, 'RAW_SCRIPT', 'Teste Broadcast', ?, 'PENDING', 'BATCH-TEST')
`);

for (const r of routers) {
  const cleanRouterName = (r.name || 'MikroTik').replace(/"/g, '');
  const personalizedScript = rawScriptTemplate
    .replace(/\{\{TOKEN\}\}/gi, r.token)
    .replace(/\{\{ROUTER_NAME\}\}/gi, cleanRouterName)
    .replace(/\{\{ROUTER_ID\}\}/gi, String(r.id))
    .replace(/SEU_TOKEN_AQUI/g, r.token)
    .replace(/TOKEN_DO_ROTEADOR/g, r.token)
    .replace(/MK-TOKEN-AQUI/g, r.token)
    .replace(/<TOKEN>/g, r.token);
  insertCmd.run(r.id, personalizedScript);
}

const cmdsMatriz = db.prepare('SELECT payload FROM router_commands WHERE router_id = ?').all(r1.lastInsertRowid);
const cmdsFilial = db.prepare('SELECT payload FROM router_commands WHERE router_id = ?').all(r2.lastInsertRowid);

assert(cmdsMatriz[0].payload.includes('MK-MATRIZ-1111'), 'Deveria conter token da Matriz');
assert(cmdsMatriz[0].payload.includes('RB Matriz'), 'Deveria conter nome RB Matriz');
assert(cmdsFilial[0].payload.includes('MK-FILIAL-2222'), 'Deveria conter token da Filial');
assert(cmdsFilial[0].payload.includes('RB Filial'), 'Deveria conter nome RB Filial');

console.log(' -> Comandos gerados:');
console.log('Matriz:', cmdsMatriz[0].payload);
console.log('Filial:', cmdsFilial[0].payload);

db.close();
try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch (e) {}

console.log('----------------------------------------------------');
console.log('TESTE DE MACROS NO BROADCAST PASSOU 100%! ✅');
console.log('----------------------------------------------------');
