// ─────────────────────────────────────────────────────────────
// Base de datos de Zevorus
//
// Usa @libsql/client, que funciona igual con:
//   • Turso (base de datos SQLite en la nube, GRATIS y permanente) → en Render.
//       TURSO_DATABASE_URL = libsql://tu-base.turso.io
//       TURSO_AUTH_TOKEN   = el token que te da Turso
//   • Un archivo local zevorus.db → cuando trabajas en tu compu (sin variables).
//
// Así los usuarios, empresas y eventos ya NO se borran cuando Render
// reinicia o cuando subes cambios a GitHub.
// ─────────────────────────────────────────────────────────────
const { createClient } = require('@libsql/client');
const path   = require('path');
const bcrypt = require('bcryptjs');

const url = process.env.TURSO_DATABASE_URL
  || 'file:' + (process.env.DB_PATH || path.join(__dirname, 'zevorus.db'));

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
console.log('[DB] Conectado a', url.startsWith('file:') ? 'archivo local ' + url.slice(5) : 'Turso (' + url + ')');

// libsql no acepta "undefined" como parámetro: lo convertimos a null.
const clean = args => args.map(a => (a === undefined ? null : a));

// Convierte una fila de libsql en un objeto normal { columna: valor }.
const toObj = (rs, row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]));

// Misma forma de uso que antes (db.prepare(sql).get/all/run), pero con await.
const db = {
  prepare(sql) {
    return {
      async get(...args) {
        const rs = await client.execute({ sql, args: clean(args) });
        return rs.rows.length ? toObj(rs, rs.rows[0]) : undefined;
      },
      async all(...args) {
        const rs = await client.execute({ sql, args: clean(args) });
        return rs.rows.map(r => toObj(rs, r));
      },
      async run(...args) {
        const rs = await client.execute({ sql, args: clean(args) });
        return { lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null, changes: rs.rowsAffected };
      },
    };
  },
  exec: sql => client.executeMultiple(sql),
};

// Ignora el error si la columna ya existe.
async function tryExec(sql) { try { await client.execute(sql); } catch (_) {} }

// ── Equipo de soporte Zevorus (agentes) ───────────────────────
// Contraseña inicial de todos: zevorus2026
const AGENTS = [
  ['Patrick',             'patrick@zevorus.com'],
  ['Sebastian',           'sebastian@zevorus.com'],
  ['Ian',                 'ian@zevorus.com'],
  ['Alejandro Rodriguez', 'alejandro.rodriguez@zevorus.com'],
  ['Ángel',               'angel@zevorus.com'],
  ['Victor Gonzalez',     'victor.gonzalez@zevorus.com'],
  ['Mariana Novelo',      'mariana.novelo@zevorus.com'],
  ['Jimena Belem',        'jimena.belem@zevorus.com'],
  ['Mafer',               'mafer@zevorus.com'],
  ['Yovana Sánchez',      'yovana@zevorus.com'],
];
// Fecha de alta del equipo de Zevorus en la plataforma.
const STAFF_CREATED_AT = '2026-10-19 12:00:00';

async function init() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      industry    TEXT,
      contact     TEXT,
      email       TEXT,
      phone       TEXT,
      status      TEXT    DEFAULT 'active',
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      email       TEXT    UNIQUE NOT NULL,
      password    TEXT    NOT NULL,
      role        TEXT    NOT NULL CHECK(role IN ('admin','agent','client')),
      company     TEXT,
      org_id      INTEGER REFERENCES organizations(id),
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL,
      description  TEXT    NOT NULL,
      priority     TEXT    NOT NULL CHECK(priority IN ('low','medium','high','critical')),
      status       TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
      category     TEXT    NOT NULL,
      mitre_tactic TEXT,
      org_id       INTEGER REFERENCES organizations(id),
      assigned_to  INTEGER REFERENCES users(id),
      created_by   INTEGER REFERENCES users(id),
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      resolved_at  TEXT,
      odoo_id      INTEGER
    );

    CREATE TABLE IF NOT EXISTS ebc_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL,
      description  TEXT,
      date         TEXT    NOT NULL,
      location     TEXT,
      org_id       INTEGER REFERENCES organizations(id),
      status       TEXT    DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
      capacity     INTEGER DEFAULT 20,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ebc_participants (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id  INTEGER REFERENCES ebc_events(id),
      name      TEXT    NOT NULL,
      email     TEXT    NOT NULL,
      company   TEXT,
      role      TEXT,
      attended  INTEGER DEFAULT 0,
      user_id   INTEGER REFERENCES users(id),
      joined_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ticket_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id  INTEGER REFERENCES tickets(id),
      user_id    INTEGER REFERENCES users(id),
      comment    TEXT    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_requests (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre     TEXT    NOT NULL,
      empresa    TEXT,
      email      TEXT    NOT NULL,
      telefono   TEXT,
      motivo     TEXT,
      mensaje    TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
      created_at TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Columnas agregadas después (para bases de datos que ya existían).
  await tryExec(`ALTER TABLE tickets ADD COLUMN odoo_id INTEGER`);
  await tryExec(`ALTER TABLE users ADD COLUMN org_id INTEGER REFERENCES organizations(id)`);
  await tryExec(`ALTER TABLE ebc_participants ADD COLUMN user_id INTEGER REFERENCES users(id)`);
  // Estado de la cuenta: 'active' o 'pending' (esperando aprobación).
  await tryExec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  // Líder de la empresa: aprueba a las nuevas cuentas de su organización.
  await tryExec(`ALTER TABLE users ADD COLUMN is_leader INTEGER NOT NULL DEFAULT 0`);

  // Correo confirmado (las cuentas que ya existían se consideran confirmadas).
  await tryExec(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1`);
  // Bloqueo por intentos fallidos de contraseña.
  await tryExec(`ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`);
  await tryExec(`ALTER TABLE users ADD COLUMN locked_until INTEGER`);

  // Enlaces para confirmar el correo de una cuenta nueva.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT    NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Enlaces para restablecer contraseña (se guarda solo el hash del token).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT    NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Liga a cada cliente con su organización (por nombre de empresa) si aún no la tiene.
  await db.exec(`
    UPDATE users SET org_id = (SELECT id FROM organizations WHERE lower(organizations.name) = lower(users.company))
    WHERE role = 'client' AND org_id IS NULL AND company IS NOT NULL;
  `);

  const hash = bcrypt.hashSync('zevorus2026', 10);
  const seedUser = db.prepare(`INSERT OR IGNORE INTO users (name,email,password,role,company) VALUES (?,?,?,?,?)`);

  // ── Datos de ejemplo: solo la primera vez (base vacía) ──────
  const { c } = await db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (c === 0) {
    const seedOrg     = db.prepare(`INSERT OR IGNORE INTO organizations (name,industry,contact,email,phone,status) VALUES (?,?,?,?,?,?)`);
    const seedTicket  = db.prepare(`INSERT OR IGNORE INTO tickets (id,title,description,priority,status,category,mitre_tactic,org_id,assigned_to,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const seedEvent   = db.prepare(`INSERT OR IGNORE INTO ebc_events (id,title,description,date,location,org_id,status,capacity) VALUES (?,?,?,?,?,?,?,?)`);
    const seedPart    = db.prepare(`INSERT OR IGNORE INTO ebc_participants (event_id,name,email,company,role,attended) VALUES (?,?,?,?,?,?)`);
    const seedComment = db.prepare(`INSERT OR IGNORE INTO ticket_comments (ticket_id,user_id,comment) VALUES (?,?,?)`);

    await seedUser.run('Pablo Álvarez',  'pablo@zevorus.com',       hash, 'admin',  'Zevorus');   // id 1
    await seedUser.run('Yovana Sánchez', 'yovana@zevorus.com',      hash, 'agent',  'Zevorus');   // id 2
    await seedUser.run('Carlos Méndez',  'carlos@grupoalfa.mx',     hash, 'client', 'Grupo Alfa');
    await seedUser.run('Laura Reyes',    'laura@industriasnova.mx', hash, 'client', 'Industrias Nova');

    await seedOrg.run('Grupo Alfa',       'Manufacturing', 'Carlos Méndez', 'carlos@grupoalfa.mx',     '999-100-2001', 'active');
    await seedOrg.run('Industrias Nova',  'Energy',        'Laura Reyes',   'laura@industriasnova.mx', '999-200-3002', 'active');
    await seedOrg.run('Finanzas del Sur', 'Finance',       'Rodrigo Vega',  'r.vega@finanzassur.mx',   '999-300-4003', 'active');
    await seedOrg.run('MediSalud',        'Healthcare',    'Ana Torres',    'a.torres@medisalud.mx',   '999-400-5004', 'active');
    await seedOrg.run('LogiTrans',        'Logistics',     'Marco Ruiz',    'm.ruiz@logitrans.mx',     '999-500-6005', 'prospect');

    await db.exec(`
      UPDATE users SET org_id = (SELECT id FROM organizations WHERE organizations.name = users.company)
      WHERE role = 'client' AND org_id IS NULL AND company IS NOT NULL;
    `);

    await seedTicket.run(1,'Suspicious login attempts on admin portal','Multiple failed login attempts detected from IP 185.220.x.x between 02:00-04:00 hrs','critical','in_progress','Incident','Initial Access',1,2,3);
    await seedTicket.run(2,'Ransomware alert on endpoint WS-042','EDR triggered alert for ransomware-like behavior. File encryption pattern detected on shared drive.','critical','open','Incident','Impact',2,2,4);
    await seedTicket.run(3,'Firewall rule review request','Request to review and update outbound firewall rules for the ERP system after recent migration.','medium','open','Service Request',null,3,2,3);
    await seedTicket.run(4,'VPN access provisioning for remote team','5 new remote employees need VPN credentials and access to internal systems.','low','resolved','Service Request',null,1,2,3);
    await seedTicket.run(5,'Phishing email campaign detected','Users received suspicious emails impersonating Microsoft 365. 3 users clicked the link.','high','in_progress','Incident','Initial Access',4,2,4);
    await seedTicket.run(6,'SSL certificate expiring in 7 days','Production server certificate expires on 2026-09-06. Renewal process must be initiated.','high','open','Change Request',null,2,2,2);
    await seedTicket.run(7,'Log collection gap in SIEM','Chronicle not receiving logs from on-prem Windows servers since 2026-08-15.','medium','in_progress','Incident','Defense Evasion',1,2,2);
    await seedTicket.run(8,'Monthly vulnerability scan report','Request for automated vulnerability scan on external-facing assets.','low','resolved','Service Request',null,3,2,3);

    await seedEvent.run(1,'Google SecOps Live Demo – Grupo Alfa','Executive immersion session showcasing real-time threat detection and IR workflows on Google Security Operations.','2026-09-10','TecniA Park, Sala A3',1,'scheduled',15);
    await seedEvent.run(2,'MITRE ATT&CK Workshop – Industrias Nova','Hands-on workshop mapping recent incidents to ATT&CK framework. War room simulation included.','2026-09-18','TecniA Park, Sala B1',2,'scheduled',12);
    await seedEvent.run(3,'SecOps Executive Briefing – Finanzas del Sur','Strategic overview of SOC capabilities and compliance alignment for financial sector.','2026-08-20','Virtual (Google Meet)',3,'completed',25);
    await seedEvent.run(4,'Threat Intelligence Session – MediSalud','CTI briefing covering healthcare-specific threats and Mandiant intel feeds.','2026-10-05','TecniA Park, Sala A3',4,'scheduled',10);

    await seedPart.run(1,'Carlos Méndez','carlos@grupoalfa.mx','Grupo Alfa','CTO',0);
    await seedPart.run(1,'Patricia Leal','p.leal@grupoalfa.mx','Grupo Alfa','IT Manager',0);
    await seedPart.run(1,'Héctor Soto','h.soto@grupoalfa.mx','Grupo Alfa','CISO',0);
    await seedPart.run(2,'Laura Reyes','laura@industriasnova.mx','Industrias Nova','VP Operations',0);
    await seedPart.run(2,'Javier Mora','j.mora@industriasnova.mx','Industrias Nova','IT Director',0);
    await seedPart.run(3,'Rodrigo Vega','r.vega@finanzassur.mx','Finanzas del Sur','CEO',1);
    await seedPart.run(3,'Claudia Ibarra','c.ibarra@finanzassur.mx','Finanzas del Sur','CFO',1);
    await seedPart.run(3,'Eduardo Ramos','e.ramos@finanzassur.mx','Finanzas del Sur','CTO',1);

    await seedComment.run(1,2,'Blocked the IP range at firewall level. Monitoring for further attempts. No successful logins confirmed.');
    await seedComment.run(1,2,'Correlated with Chronicle SIEM. Alert tagged as TA0001 – Initial Access. Escalating to client.');
    await seedComment.run(5,2,'Link destination confirmed as credential harvesting page. Engaging IR playbook.');
    await seedComment.run(7,2,'Issue traced to GPO change that removed the Chronicle forwarder service. Redeployment in progress.');
  }

  // ── Equipo Zevorus: se revisa en cada arranque ──────────────
  // INSERT OR IGNORE no duplica: solo agrega a quien falte.
  for (const [name, email] of AGENTS) await seedUser.run(name, email, hash, 'agent', 'Zevorus');

  // Fecha de alta del equipo: 19 de octubre de 2026.
  const emails = AGENTS.map(a => a[1]);
  await db.prepare(`UPDATE users SET created_at = ? WHERE email IN (${emails.map(() => '?').join(',')})`)
          .run(STAFF_CREATED_AT, ...emails);

  // Cada empresa con clientes y sin líder: su cliente activo más antiguo queda como líder.
  await db.exec(`
    UPDATE users SET is_leader = 1
    WHERE id IN (
      SELECT MIN(u.id) FROM users u
      WHERE u.role = 'client' AND u.status = 'active' AND u.org_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM users l WHERE l.org_id = u.org_id AND l.is_leader = 1)
      GROUP BY u.org_id
    );
  `);

  // Mirian Durán ya no forma parte del equipo: sus tickets y comentarios
  // pasan a Yovana y después se elimina su cuenta.
  const mirian = await db.prepare(`SELECT id FROM users WHERE email = 'mirian@zevorus.com'`).get();
  if (mirian) {
    const yovana = await db.prepare(`SELECT id FROM users WHERE email = 'yovana@zevorus.com'`).get();
    await db.prepare('UPDATE tickets SET assigned_to = ? WHERE assigned_to = ?').run(yovana.id, mirian.id);
    await db.prepare('UPDATE tickets SET created_by = ? WHERE created_by = ?').run(yovana.id, mirian.id);
    await db.prepare('UPDATE ticket_comments SET user_id = ? WHERE user_id = ?').run(yovana.id, mirian.id);
    await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(mirian.id);
    await db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(mirian.id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(mirian.id);
    console.log('[DB] Cuenta de Mirian Durán eliminada; sus tickets pasaron a Yovana Sánchez');
  }
}

// ── Reparto de los tickets de ejemplo entre el equipo (solo una vez) ──
async function distributeSampleTickets() {
  await db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);`);
  if (await db.prepare(`SELECT 1 FROM app_meta WHERE key='tickets_distributed'`).get()) return;

  const yovana = await db.prepare(`SELECT id FROM users WHERE email='yovana@zevorus.com'`).get();
  const agents = [];
  for (const [, email] of AGENTS) {
    const a = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (a) agents.push(a.id);
  }
  // Tickets de ejemplo (1–8) que siguen asignados a Yovana o sin asignar: uno por persona.
  const tickets = await db.prepare(`SELECT id FROM tickets WHERE id <= 8 AND (assigned_to IS NULL OR assigned_to = ?) ORDER BY id`)
                          .all(yovana ? yovana.id : -1);
  for (let i = 0; i < tickets.length; i++) {
    const agentId = agents[i % agents.length];
    await db.prepare('UPDATE tickets SET assigned_to=? WHERE id=?').run(agentId, tickets[i].id);
    // Los comentarios de ejemplo de ese ticket los firma quien lo atiende.
    if (yovana) await db.prepare('UPDATE ticket_comments SET user_id=? WHERE ticket_id=? AND user_id=? AND id <= 4')
                        .run(agentId, tickets[i].id, yovana.id);
  }
  await db.prepare(`INSERT INTO app_meta (key, value) VALUES ('tickets_distributed', datetime('now'))`).run();
  if (tickets.length) console.log(`[DB] ${tickets.length} tickets de ejemplo repartidos entre el equipo`);
}

db.ready = init().then(distributeSampleTickets);
module.exports = db;
