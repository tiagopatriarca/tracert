import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
export const db = new DatabaseSync(dbPath);

export function initDatabase() {
  // Clientes / Empresas
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Roteadores (MikroTiks) - com telemetria de hardware/firmware
  db.exec(`
    CREATE TABLE IF NOT EXISTS routers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      model TEXT,
      routeros_version TEXT,
      firmware_version TEXT,
      cpu_model TEXT,
      cpu_count INTEGER,
      cpu_load INTEGER,
      total_memory INTEGER, /* em MB */
      free_memory INTEGER,
      uptime TEXT,
      board_name TEXT,
      serial_number TEXT,
      last_seen DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
  `);

  // Grupos de Acesso
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      whatsapp_number TEXT,
      notify_link_down INTEGER DEFAULT 1,
      notify_sdwan_switch INTEGER DEFAULT 1,
      notify_router_offline INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Relacionamento Grupo <-> Roteadores
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_routers (
      group_id INTEGER NOT NULL,
      router_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, router_id),
      FOREIGN KEY (group_id) REFERENCES access_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );
  `);

  // Usuários do Sistema
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'USER',
      group_id INTEGER,
      inactivity_timeout_min INTEGER DEFAULT 15,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES access_groups(id) ON DELETE SET NULL
    );
  `);

  // Configuração Evolution API (WhatsApp)
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT,
      api_key TEXT,
      instance_name TEXT,
      enabled INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Status dos Links WAN
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      link_name TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER,
      last_changed DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(router_id, link_name),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );
  `);

  // Histórico de Queda e Retorno (SLA)
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_outages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      link_name TEXT NOT NULL,
      down_time DATETIME NOT NULL,
      up_time DATETIME,
      duration_seconds INTEGER,
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );
  `);

  // Histórico de Eventos
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      link_name TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );
  `);

  // Destinos SD-WAN
  db.exec(`
    CREATE TABLE IF NOT EXISTS sdwan_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      active_link TEXT,
      metric_rtt REAL,
      metric_loss REAL,
      last_tested DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(router_id, address),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );
  `);

  // Timeline SD-WAN
  db.exec(`
    CREATE TABLE IF NOT EXISTS sdwan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL,
      link_name TEXT NOT NULL,
      started_at DATETIME NOT NULL,
      ended_at DATETIME,
      test_count INTEGER DEFAULT 1,
      avg_rtt REAL,
      jitter REAL,
      is_current INTEGER DEFAULT 1,
      FOREIGN KEY (target_id) REFERENCES sdwan_targets(id) ON DELETE CASCADE
    );
  `);

  // Métricas SD-WAN
  db.exec(`
    CREATE TABLE IF NOT EXISTS sdwan_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL,
      link_name TEXT NOT NULL,
      rtt REAL NOT NULL,
      loss REAL NOT NULL,
      tested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (target_id) REFERENCES sdwan_targets(id) ON DELETE CASCADE
    );
  `);

  // Cria apenas o usuário admin inicial se zerado, sem dados fakes
  const userCheck = db.prepare('SELECT count(*) as count FROM users').get();
  if (userCheck.count === 0) {
    db.exec(`
      INSERT INTO users (id, name, username, password_hash, role, group_id, inactivity_timeout_min)
      VALUES (1, 'Administrador', 'admin', '$2a$10$9v1P3uC48t3aB4vC3tF6eeo1fS4L/K/6N/QeT0rU/O7X7f3gO6X1a', 'ADMIN', NULL, 15);

      INSERT INTO evolution_config (id, base_url, api_key, instance_name, enabled)
      VALUES (1, '', '', '', 0);
    `);
  }
}
