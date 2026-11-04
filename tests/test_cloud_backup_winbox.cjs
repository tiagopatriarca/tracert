const assert = require('assert');
const fs = require('fs');
const path = require('path');

const testDataDir = path.join(__dirname, 'test_data');
process.env.DATA_DIR = testDataDir;

if (fs.existsSync(testDataDir)) {
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch (e) {}
}
if (!fs.existsSync(testDataDir)) {
  fs.mkdirSync(testDataDir, { recursive: true });
}

const { db, initDatabase } = require('../db');
initDatabase();

console.log('[TEST] 1. Validando colunas e tabelas do banco...');
const routerCols = db.prepare("PRAGMA table_info(routers)").all().map(c => c.name);
assert(routerCols.includes('cloud_dns_name'), 'Deveria ter cloud_dns_name');
assert(routerCols.includes('cloud_public_ip'), 'Deveria ter cloud_public_ip');
assert(routerCols.includes('cloud_status'), 'Deveria ter cloud_status');

const backupCols = db.prepare("PRAGMA table_info(router_backups)").all().map(c => c.name);
assert(backupCols.includes('router_id'), 'Deveria ter router_id');
assert(backupCols.includes('filename'), 'Deveria ter filename');
assert(backupCols.includes('file_size'), 'Deveria ter file_size');
console.log(' -> Estrutura de tabelas OK!');

console.log('[TEST] 2. Criando cliente e roteador de teste...');
const clientRes = db.prepare("INSERT INTO clients (name) VALUES ('Cliente Backup Teste')").run();
const clientId = clientRes.lastInsertRowid;

const testToken = 'token_test_backup_12345';
const routerRes = db.prepare(`
  INSERT INTO routers (client_id, name, token, cloud_status)
  VALUES (?, 'RB Teste Backup', ?, 'disabled')
`).run(clientId, testToken);
const routerId = routerRes.lastInsertRowid;

// Simula upload de 6 backups sequenciais para validar rotação com retenção de 4
console.log('[TEST] 3. Simulando política de retenção (6 backups enviados, mantendo estritamente 4)...');
const routerBackupDir = path.join(testDataDir, 'backups', String(routerId));
fs.mkdirSync(routerBackupDir, { recursive: true });

for (let i = 1; i <= 6; i++) {
  const filename = `backup_RB_Teste_${i}.rsc`;
  const filePath = path.join(routerBackupDir, filename);
  const sampleRsc = `# RouterOS 7.15 export\r\n# Backup number ${i}\r\n/system identity set name="RB-TEST-${i}"\r\n`;
  fs.writeFileSync(filePath, sampleRsc, 'utf8');
  const stats = fs.statSync(filePath);

  // Insere no banco
  db.prepare(`
    INSERT INTO router_backups (router_id, filename, file_size, created_at)
    VALUES (?, ?, ?, datetime('now', '+${i} seconds'))
  `).run(routerId, filename, stats.size);

  // Aplica a mesma regra de retenção do server.js
  const backups = db.prepare('SELECT id, filename FROM router_backups WHERE router_id = ? ORDER BY id DESC').all(routerId);
  if (backups.length > 4) {
    const toDelete = backups.slice(4);
    for (const b of toDelete) {
      const p = path.join(routerBackupDir, b.filename);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      db.prepare('DELETE FROM router_backups WHERE id = ?').run(b.id);
    }
  }
}

// Verifica banco
const remainingInDb = db.prepare('SELECT id, filename FROM router_backups WHERE router_id = ? ORDER BY id ASC').all(routerId);
console.log(' -> Backups restantes no SQLite:', remainingInDb.map(b => b.filename));
assert.strictEqual(remainingInDb.length, 4, 'Deveria restar exatamente 4 backups no SQLite');
assert.strictEqual(remainingInDb[0].filename, 'backup_RB_Teste_3.rsc');
assert.strictEqual(remainingInDb[3].filename, 'backup_RB_Teste_6.rsc');

// Verifica filesystem
const filesOnDisk = fs.readdirSync(routerBackupDir);
console.log(' -> Backups restantes no disco:', filesOnDisk);
assert.strictEqual(filesOnDisk.length, 4, 'Deveria restar exatamente 4 arquivos no disco');
assert(!filesOnDisk.includes('backup_RB_Teste_1.rsc'), 'Backup 1 deveria ter sido purgado');
assert(!filesOnDisk.includes('backup_RB_Teste_2.rsc'), 'Backup 2 deveria ter sido purgado');
assert(filesOnDisk.includes('backup_RB_Teste_6.rsc'), 'Backup 6 deve estar presente');

console.log('[TEST] 4. Testando atualização de Cloud DDNS e IP...');
db.prepare(`
  UPDATE routers SET
    cloud_dns_name = ?,
    cloud_public_ip = ?,
    cloud_status = 'enabled'
  WHERE id = ?
`).run('ccr2004.sn.mynetname.net', '177.136.25.10', routerId);

const updatedRouter = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId);
assert.strictEqual(updatedRouter.cloud_dns_name, 'ccr2004.sn.mynetname.net');
assert.strictEqual(updatedRouter.cloud_public_ip, '177.136.25.10');
assert.strictEqual(updatedRouter.cloud_status, 'enabled');
console.log(' -> Campos de Cloud DDNS atualizados com sucesso!');

db.close();
try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch (e) {}

console.log('----------------------------------------------------');
console.log('TODOS OS TESTES DE RETENÇÃO E CLOUD PASSARAM 100%! ✅');
console.log('----------------------------------------------------');
