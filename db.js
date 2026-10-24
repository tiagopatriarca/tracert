import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Permite customizar o diretório do banco via variável de ambiente (ex: /app/data em Docker)
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

  // Roteadores (MikroTiks)
  db.exec(`
    CREATE TABLE IF NOT EXISTS routers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      model TEXT,
      last_seen DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
  `);

  // Grupos de Acesso e Notificação WhatsApp
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

  // Relacionamento Grupo <-> MikroTiks permitidos
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

  // Status dos Links WAN (Atual)
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

  // Histórico de Queda e Retorno para Relatório de Disponibilidade / SLA
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

  // Histórico Simples de Eventos
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

  // Métricas para Gráficos
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

  // Popula dados iniciais (admin/admin123) se a base estiver zerada
  const userCheck = db.prepare('SELECT count(*) as count FROM users').get();
  if (userCheck.count === 0) {
    db.exec(`
      INSERT INTO clients (id, name, description) VALUES (1, 'ARO Marketing', 'Cliente Matriz');
      INSERT INTO routers (id, client_id, name, token, model, last_seen) VALUES (1, 1, 'MikroTik CCR2004 Matriz', 'MK-ARO-MATRIZ-01', 'CCR2004-16G-2S+', datetime('now'));

      INSERT INTO access_groups (id, name, whatsapp_number, notify_link_down, notify_sdwan_switch, notify_router_offline) 
      VALUES (1, 'Administradores TI Plus', '5585999999999', 1, 1, 1);

      INSERT INTO group_routers (group_id, router_id) VALUES (1, 1);

      INSERT INTO users (id, name, username, password_hash, role, group_id, inactivity_timeout_min)
      VALUES (1, 'Administrador Geral', 'admin', '$2a$10$9v1P3uC48t3aB4vC3tF6eeo1fS4L/K/6N/QeT0rU/O7X7f3gO6X1a', 'ADMIN', 1, 15);

      INSERT INTO evolution_config (id, base_url, api_key, instance_name, enabled)
      VALUES (1, 'https://api.evolution.seuservidor.com', '', 'instancia-tiplus', 0);

      INSERT INTO link_statuses (router_id, link_name, status, score, last_changed) VALUES 
      (1, 'ITS', 'UP', 8, datetime('now')),
      (1, 'CLARO', 'UP', 8, datetime('now'));

      INSERT INTO link_outages (router_id, link_name, down_time, up_time, duration_seconds) VALUES
      (1, 'CLARO', datetime('now', '-2 days'), datetime('now', '-2 days', '+18 minutes'), 1080),
      (1, 'CLARO', datetime('now', '-1 days'), datetime('now', '-1 days', '+7 minutes'), 420),
      (1, 'ITS', datetime('now', '-4 hours'), datetime('now', '-4 hours', '+12 minutes'), 720);

      INSERT INTO sdwan_targets (id, router_id, name, address, active_link, metric_rtt, metric_loss, last_tested)
      VALUES 
      (1, 1, 'Email - Entrada', 'outlook.office365.com', 'ITS', 0.42, 0, datetime('now')),
      (2, 1, 'Email - Saida', 'smtp.office365.com', 'ITS', 0.38, 0, datetime('now')),
      (3, 1, 'Gmail', 'gmail.com', 'ITS', 0.55, 0, datetime('now')),
      (4, 1, 'Restrito', 'restrito.aromarketing.com.br', 'ITS', 0.60, 0, datetime('now')),
      (5, 1, 'Site - Aro', 'aromarketing.com.br', 'ITS', 0.26, 0, datetime('now'));

      INSERT INTO sdwan_history (target_id, link_name, started_at, ended_at, test_count, avg_rtt, jitter, is_current)
      VALUES
      (1, 'ITS', datetime('now', '-30 minutes'), NULL, 9, 0.42, 0.42, 1),
      (1, 'CLARO', datetime('now', '-1 hours'), datetime('now', '-30 minutes'), 15, 1.55, 1.55, 0),
      (1, 'ITS', datetime('now', '-6 hours'), datetime('now', '-1 hours'), 120, 0.14, 0.14, 0);
    `);
  }
}
