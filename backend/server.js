require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const crypto   = require('crypto');
const db       = require('./database');
const odoo     = require('./odoo');
const mailer   = require('./mailer');

const app    = express();
const SECRET = process.env.JWT_SECRET || 'zevorus_jwt_secret_2026';
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET no está configurado: usa una clave larga y aleatoria en producción');

const SESSION_HOURS   = 8;              // duración de la sesión
const RESET_MINUTES   = 60;             // validez del enlace para cambiar contraseña
const VERIFY_HOURS    = 24;             // validez del enlace para confirmar el correo
const SESSION_EXPIRED = 'Tu sesión expiró. Vuelve a iniciar sesión.';

app.set('trust proxy', 1);              // Render usa proxy: así req.protocol sale "https"
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// URL pública de la plataforma (para los enlaces de los correos).
function appUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '') + '/app/';
}

// Verifica el token y vuelve a leer al usuario de la base de datos en cada petición.
// Así, si la cuenta se borra, queda pendiente o le cambian el rol/empresa,
// el cambio aplica de inmediato sin esperar a que el token caduque.
async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: SESSION_EXPIRED, code: 'SESSION_EXPIRED' });
  let payload;
  try { payload = jwt.verify(header.split(' ')[1], SECRET); }
  catch { return res.status(401).json({ error: SESSION_EXPIRED, code: 'SESSION_EXPIRED' }); }

  const user = await db.prepare('SELECT id,name,email,role,company,org_id,status,is_leader FROM users WHERE id=?').get(payload.id);
  if (!user || user.status !== 'active')
    return res.status(401).json({ error: SESSION_EXPIRED, code: 'SESSION_EXPIRED' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

// Una sesión EBC sin organización (org_id NULL) es abierta: cualquier cliente puede verla e inscribirse.
function canSeeEvent(req, event) {
  return event.org_id == null || sameOrgOrStaff(req, event.org_id);
}

function sameOrgOrStaff(req, orgId) {
  if (req.user.role !== 'client') return true;
  return req.user.org_id != null && Number(req.user.org_id) === Number(orgId);
}

// Staff (admin/agente) o el líder de esa misma empresa.
function canManageMember(req, member) {
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  return req.user.role === 'client' && req.user.is_leader === 1 &&
         member.role === 'client' && Number(member.org_id) === Number(req.user.org_id);
}

// ── REGISTRO / ALTA DE USUARIOS ───────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name, org_id: user.org_id },
                  SECRET, { expiresIn: `${SESSION_HOURS}h` });
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, company: u.company,
           org_id: u.org_id, is_leader: u.is_leader || 0, status: u.status };
}

// Contraseña segura: mínimo 8 caracteres, una mayúscula, un número y un símbolo.
function passwordError(p = '') {
  const missing = [];
  if (p.length < 8)              missing.push('mínimo 8 caracteres');
  if (!/[A-Z]/.test(p))          missing.push('una letra mayúscula');
  if (!/[0-9]/.test(p))          missing.push('un número');
  if (!/[^A-Za-z0-9]/.test(p))   missing.push('un símbolo especial (por ejemplo ! @ # $ % &)');
  return missing.length ? `La contraseña debe tener: ${missing.join(', ')}.` : null;
}

// Sin SMTP no se pueden mandar correos de confirmación: en ese caso las cuentas
// se activan directo (para que la plataforma no quede inservible) y se avisa en los logs.
const VERIFY_EMAILS = () => mailer.isEnabled();

// Valida y crea el usuario. Devuelve { user } o { error, status }.
//  • Empresa NUEVA   → se crea la organización y esta persona queda como su líder.
//  • Empresa EXISTENTE → la cuenta queda "pending" hasta que el líder o el equipo Zevorus la apruebe.
//  • Creada por un admin → siempre activa y con correo confirmado.
async function createUser({ name, email, password, company, role }, { byAdmin = false } = {}) {
  name     = (name || '').trim();
  email    = (email || '').trim().toLowerCase();
  company  = (company || '').trim();
  password = password || '';

  if (!name || !email || !password) return { status: 400, error: 'Nombre, email y contraseña son obligatorios' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { status: 400, error: 'El email no es válido' };
  const pwErr = passwordError(password);
  if (pwErr) return { status: 400, error: pwErr };
  if (!['admin', 'agent', 'client'].includes(role)) return { status: 400, error: 'Rol no válido' };
  if (role === 'client' && !company) return { status: 400, error: 'La empresa es obligatoria para clientes' };
  if (await db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email))
    return { status: 409, error: 'Ya existe una cuenta con ese email. Si no recuerdas tu contraseña, usa "¿Olvidaste tu contraseña?"' };

  let org_id = null, status = 'active', is_leader = 0;
  if (role === 'client') {
    const existing = await db.prepare('SELECT id, name FROM organizations WHERE lower(name) = lower(?)').get(company);
    if (existing) {
      org_id  = existing.id;
      company = existing.name;                     // usa el nombre oficial ya registrado
      if (!byAdmin) status = 'pending';
    } else {
      org_id = (await db.prepare("INSERT INTO organizations (name, status, contact, email) VALUES (?, 'prospect', ?, ?)")
                 .run(company, name, email)).lastInsertRowid;
      is_leader = 1;
    }
  }
  const email_verified = byAdmin || !VERIFY_EMAILS() ? 1 : 0;

  const hash = bcrypt.hashSync(password, 10);
  const id = (await db.prepare(`INSERT INTO users (name,email,password,role,company,org_id,status,is_leader,email_verified)
                                VALUES (?,?,?,?,?,?,?,?,?)`)
               .run(name, email, hash, role, company || 'Zevorus', org_id, status, is_leader, email_verified)).lastInsertRowid;
  return { user: await db.prepare('SELECT * FROM users WHERE id = ?').get(id) };
}

// ── Tokens de un solo uso para enlaces por correo ─────────────
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
const MAX_EMAILS_PER_HOUR = 5;          // límite de reenvíos por cuenta y por tipo de correo

async function createEmailToken(table, userId, minutes) {
  const sent = (await db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE user_id=? AND created_at > datetime('now','-1 hour')`)
                  .get(userId)).c;
  if (sent >= MAX_EMAILS_PER_HOUR) return null;
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare(`INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?,?,?)`)
          .run(userId, sha256(token), Date.now() + minutes * 60 * 1000);
  return token;
}

async function useEmailToken(table, token) {
  if (!token) return null;
  const row = await db.prepare(`SELECT * FROM ${table} WHERE token_hash=?`).get(sha256(token));
  if (!row || row.used || row.expires_at < Date.now()) return null;
  await db.prepare(`UPDATE ${table} SET used=1 WHERE user_id=?`).run(row.user_id);   // invalida todos los de esa cuenta
  return row;
}

async function sendVerificationEmail(req, user) {
  const token = await createEmailToken('email_verifications', user.id, VERIFY_HOURS * 60);
  if (!token) return false;
  const link = `${appUrl(req)}?verify=${token}`;
  if (process.env.LOG_EMAIL_LINKS) console.log(`[Verify] Enlace para ${user.email}: ${link}`);   // solo para pruebas
  try {
    if (mailer.isEnabled()) await mailer.sendVerification({ to: user.email, name: user.name, link });
    else console.log(`[Verify] SMTP no configurado. Enlace para ${user.email}: ${link}`);
  } catch (err) { console.error('[Verify] No se pudo enviar a', user.email, '-', err.message); }
  return true;
}

// Avisa por correo a quien puede aprobar una cuenta pendiente.
async function notifyApprovers(req, user) {
  try {
    const leaders = await db.prepare("SELECT name, email FROM users WHERE org_id=? AND is_leader=1 AND status='active'").all(user.org_id);
    const to = leaders.length ? leaders : [{ name: 'equipo Zevorus', email: process.env.CONTACT_EMAIL_TO }];
    for (const l of to) {
      if (!l.email) continue;
      await mailer.sendAccessRequest({ to: l.email, leaderName: l.name, requester: user, company: user.company, link: appUrl(req) });
    }
  } catch (err) { console.error('[Mailer] No se pudo avisar de la solicitud de', user.email, '-', err.message); }
}

// Público: cualquiera puede crear su cuenta, SIEMPRE como cliente.
// (Nunca se acepta el rol desde el formulario público.)
app.post('/api/register', async (req, res) => {
  const { name, email, password, company } = req.body || {};
  const r = await createUser({ name, email, password, company, role: 'client' });
  if (r.error) return res.status(r.status).json({ error: r.error });
  const u = r.user;

  if (!u.email_verified) {
    await sendVerificationEmail(req, u);
    return res.status(202).json({ verify: true, email: u.email,
      message: `Te enviamos un correo a ${u.email} para confirmar tu cuenta. Abre el enlace y después inicia sesión. Si no llega en unos minutos, revisa spam o reenvíalo.` });
  }
  if (u.status === 'pending') {
    res.status(202).json({ pending: true,
      message: `Tu cuenta fue creada. ${u.company} ya está registrada en Zevorus, así que el líder de tu empresa o el equipo de Zevorus debe aprobar tu acceso. Te avisaremos por correo.` });
    return notifyApprovers(req, u);
  }
  res.status(201).json({ token: signToken(u), user: publicUser(u) });
});

// Confirmar correo (enlace del correo de registro).
app.post('/api/verify-email', async (req, res) => {
  const row = await useEmailToken('email_verifications', (req.body || {}).token);
  if (!row) return res.status(400).json({ error: 'El enlace ya expiró o ya se usó. Inicia sesión y pide que te reenviemos el correo.' });
  await db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(row.user_id);
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  if (u.status === 'pending') {
    res.json({ message: `¡Correo confirmado! Ahora el líder de ${u.company} o el equipo de Zevorus debe aprobar tu acceso. Te avisaremos por correo.` });
    return notifyApprovers(req, u);
  }
  res.json({ message: '¡Correo confirmado! Ya puedes iniciar sesión.' });
});

// Reenviar el correo de confirmación. Siempre responde lo mismo.
app.post('/api/resend-verification', async (req, res) => {
  const email = ((req.body || {}).email || '').trim().toLowerCase();
  const u = email && await db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email);
  if (u && !u.email_verified) {
    const ok = await sendVerificationEmail(req, u);
    if (!ok) return res.status(429).json({ error: 'Ya enviamos varios correos en la última hora. Espera un poco antes de pedir otro.' });
  }
  res.json({ message: 'Si la cuenta existe y no está confirmada, te enviamos un nuevo correo. Revisa también tu carpeta de spam.' });
});

// Solo admin: crear cuentas de cualquier rol (agentes, otros admins, clientes).
app.post('/api/users', auth, requireRole('admin'), async (req, res) => {
  const r = await createUser(req.body || {}, { byAdmin: true });
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json(publicUser(r.user));
});

// ── LOGIN con límite de intentos ──────────────────────────────
// Por cuenta: 5 intentos fallidos → bloqueada 15 minutos.
// Por IP: 20 intentos fallidos en 15 minutos → bloqueada (frena a quien prueba muchos correos).
const MAX_ATTEMPTS = 5, LOCK_MINUTES = 15, IP_MAX = 20;
const ipFails = new Map();   // ip → { count, until }

function ipBlocked(ip) {
  const e = ipFails.get(ip);
  if (!e) return false;
  if (e.until < Date.now()) { ipFails.delete(ip); return false; }
  return e.count >= IP_MAX;
}
function ipFail(ip) {
  const e = ipFails.get(ip);
  if (!e || e.until < Date.now()) ipFails.set(ip, { count: 1, until: Date.now() + LOCK_MINUTES * 60000 });
  else e.count++;
}
const minutesLeft = until => Math.max(1, Math.ceil((until - Date.now()) / 60000));

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (ipBlocked(req.ip))
    return res.status(429).json({ error: `Demasiados intentos desde esta conexión. Espera ${LOCK_MINUTES} minutos e intenta de nuevo.` });

  const user = await db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get((email || '').trim());
  if (user && user.locked_until && user.locked_until > Date.now())
    return res.status(429).json({ error: `Cuenta bloqueada por demasiados intentos. Intenta en ${minutesLeft(user.locked_until)} minuto(s) o usa "¿Olvidaste tu contraseña?".` });

  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    ipFail(req.ip);
    if (user) {
      const fails = (user.failed_attempts || 0) + 1;
      if (fails >= MAX_ATTEMPTS) {
        await db.prepare('UPDATE users SET failed_attempts=0, locked_until=? WHERE id=?').run(Date.now() + LOCK_MINUTES * 60000, user.id);
        return res.status(429).json({ error: `Demasiados intentos fallidos. Tu cuenta quedó bloqueada ${LOCK_MINUTES} minutos. Puedes cambiar tu contraseña con "¿Olvidaste tu contraseña?".` });
      }
      await db.prepare('UPDATE users SET failed_attempts=? WHERE id=?').run(fails, user.id);
      const left = MAX_ATTEMPTS - fails;
      return res.status(401).json({ error: `Correo o contraseña incorrectos. Te quedan ${left} intento(s).` });
    }
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }

  await db.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?').run(user.id);
  if (!user.email_verified)
    return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', email: user.email,
      error: 'Primero confirma tu correo con el enlace que te enviamos. ¿No te llegó? Puedes reenviarlo.' });
  if (user.status === 'pending')
    return res.status(403).json({ error: 'Tu cuenta todavía está pendiente de aprobación por el líder de tu empresa o por el equipo de Zevorus.' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/me', auth, async (req, res) => {
  const user = await db.prepare('SELECT id,name,email,role,company,org_id,status,is_leader,created_at FROM users WHERE id=?').get(req.user.id);
  res.json(user);
});

// ── RECUPERAR CONTRASEÑA ──────────────────────────────────────
// Siempre responde lo mismo, exista o no el correo (para no revelar qué correos tienen cuenta).
app.post('/api/forgot-password', async (req, res) => {
  const email = ((req.body || {}).email || '').trim().toLowerCase();
  const user = email && await db.prepare('SELECT id, name, email FROM users WHERE lower(email)=?').get(email);
  let token = null;
  if (user) {
    token = await createEmailToken('password_resets', user.id, RESET_MINUTES);
    if (!token) return res.status(429).json({ error: 'Ya enviamos varios correos en la última hora. Espera un poco antes de pedir otro.' });
  }
  res.json({ message: 'Si ese correo tiene una cuenta, en unos minutos te llegará un enlace para cambiar tu contraseña. Revisa también tu carpeta de spam.' });
  if (!token) return;

  const link = `${appUrl(req)}?reset=${token}`;
  if (process.env.LOG_EMAIL_LINKS) console.log(`[Reset] Enlace para ${user.email}: ${link}`);     // solo para pruebas
  try {
    if (mailer.isEnabled()) await mailer.sendPasswordReset({ to: user.email, name: user.name, link });
    else console.log(`[Reset] SMTP no configurado. Enlace para ${user.email}: ${link}`);
  } catch (err) { console.error('[Reset] No se pudo enviar el enlace a', email, '-', err.message); }
});

app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  const pwErr = passwordError(password || '');
  if (pwErr) return res.status(400).json({ error: pwErr });
  const row = await useEmailToken('password_resets', token);
  if (!row) return res.status(400).json({ error: 'El enlace ya expiró o ya se usó. Pide uno nuevo desde "¿Olvidaste tu contraseña?"' });
  // Cambiar la contraseña también desbloquea la cuenta y confirma el correo (el enlace llegó a ese correo).
  await db.prepare('UPDATE users SET password=?, failed_attempts=0, locked_until=NULL, email_verified=1 WHERE id=?')
          .run(bcrypt.hashSync(password, 10), row.user_id);
  res.json({ message: 'Tu contraseña se cambió. Ya puedes iniciar sesión con la nueva.' });
});

// ── APROBACIÓN DE CUENTAS / LÍDER DE EMPRESA ──────────────────
// Líder: ve a los miembros de su empresa (activos y pendientes con correo confirmado).
app.get('/api/team', auth, async (req, res) => {
  if (!(req.user.role === 'client' && req.user.is_leader === 1))
    return res.status(403).json({ error: 'Solo el líder de la empresa puede ver esta sección' });
  const members = await db.prepare(`SELECT id,name,email,status,is_leader,created_at FROM users
                                    WHERE org_id=? AND role='client' AND email_verified=1
                                    ORDER BY status DESC, created_at DESC`).all(req.user.org_id);
  res.json(members);
});

app.post('/api/users/:id/approve', auth, async (req, res) => {
  const member = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canManageMember(req, member)) return res.status(403).json({ error: 'No tienes permiso para aprobar esta cuenta' });
  if (member.status === 'active') return res.json({ message: 'La cuenta ya estaba activa' });
  if (!member.email_verified) return res.status(400).json({ error: 'Esta persona todavía no confirma su correo' });

  // Si la empresa aún no tiene líder, la primera cuenta aprobada lo será.
  const hasLeader = await db.prepare("SELECT id FROM users WHERE org_id=? AND is_leader=1 AND status='active'").get(member.org_id);
  await db.prepare("UPDATE users SET status='active', is_leader=? WHERE id=?").run(hasLeader ? 0 : 1, member.id);
  res.json({ message: `${member.name} ya tiene acceso` });

  try { await mailer.sendAccountApproved({ to: member.email, name: member.name, company: member.company, link: appUrl(req) }); }
  catch (err) { console.error('[Mailer] No se pudo avisar la aprobación a', member.email, '-', err.message); }
});

// Rechazar = borrar una cuenta PENDIENTE (así la persona puede volver a registrarse si fue un error).
app.delete('/api/users/:id', auth, async (req, res) => {
  const member = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canManageMember(req, member)) return res.status(403).json({ error: 'No tienes permiso para rechazar esta cuenta' });
  if (member.status !== 'pending') return res.status(400).json({ error: 'Solo se pueden rechazar cuentas pendientes' });
  await db.prepare('DELETE FROM password_resets WHERE user_id=?').run(member.id);
  await db.prepare('DELETE FROM email_verifications WHERE user_id=?').run(member.id);
  await db.prepare('DELETE FROM users WHERE id=?').run(member.id);
  res.json({ message: 'Solicitud rechazada' });
});

// Cambiar el líder de una empresa (staff o el líder actual).
app.post('/api/users/:id/make-leader', auth, async (req, res) => {
  const member = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!member || member.role !== 'client') return res.status(404).json({ error: 'Cliente no encontrado' });
  if (!canManageMember(req, member)) return res.status(403).json({ error: 'No tienes permiso para cambiar al líder' });
  if (member.status !== 'active') return res.status(400).json({ error: 'Primero aprueba la cuenta' });
  await db.prepare('UPDATE users SET is_leader=0 WHERE org_id=?').run(member.org_id);
  await db.prepare('UPDATE users SET is_leader=1 WHERE id=?').run(member.id);
  res.json({ message: `${member.name} ahora es líder de ${member.company}` });
});

app.get('/api/stats', auth, requireRole('admin', 'agent'), async (req, res) => {
  const totalTickets   = (await db.prepare('SELECT COUNT(*) as c FROM tickets').get()).c;
  const openTickets    = (await db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status='open'").get()).c;
  const inProgress     = (await db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status='in_progress'").get()).c;
  const resolved       = (await db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status='resolved' OR status='closed'").get()).c;
  const critical       = (await db.prepare("SELECT COUNT(*) as c FROM tickets WHERE priority='critical' AND status!='resolved' AND status!='closed'").get()).c;
  const totalOrgs      = (await db.prepare('SELECT COUNT(*) as c FROM organizations').get()).c;
  const upcomingEvents = (await db.prepare("SELECT COUNT(*) as c FROM ebc_events WHERE status='scheduled'").get()).c;
  const totalParticipants = (await db.prepare('SELECT COUNT(*) as c FROM ebc_participants').get()).c;

  const byPriority = await db.prepare(`
    SELECT priority, COUNT(*) as count FROM tickets
    WHERE status NOT IN ('resolved','closed') GROUP BY priority
  `).all();

  const byCategory = await db.prepare(`
    SELECT category, COUNT(*) as count FROM tickets GROUP BY category
  `).all();

  const recentTickets = await db.prepare(`
    SELECT t.id, t.title, t.priority, t.status, t.created_at,
           o.name as org_name, u.name as assigned_name
    FROM tickets t
    LEFT JOIN organizations o ON t.org_id = o.id
    LEFT JOIN users u ON t.assigned_to = u.id
    ORDER BY t.created_at DESC LIMIT 5
  `).all();

  const mitreStats = await db.prepare(`
    SELECT mitre_tactic, COUNT(*) as count FROM tickets
    WHERE mitre_tactic IS NOT NULL GROUP BY mitre_tactic ORDER BY count DESC
  `).all();

  res.json({ totalTickets, openTickets, inProgress, resolved, critical,
             totalOrgs, upcomingEvents, totalParticipants,
             byPriority, byCategory, recentTickets, mitreStats });
});

app.get('/api/tickets', auth, async (req, res) => {
  const { status, priority, search } = req.query;
  let sql = `
    SELECT t.*, o.name as org_name, u.name as assigned_name, c.name as creator_name
    FROM tickets t
    LEFT JOIN organizations o ON t.org_id = o.id
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users c ON t.created_by = c.id
    WHERE 1=1`;
  const params = [];

  if (req.user.role === 'client') {
    sql += ' AND t.org_id = ?';
    params.push(req.user.org_id);
  }
  if (status)   { sql += ' AND t.status = ?';   params.push(status); }
  if (priority) { sql += ' AND t.priority = ?';  params.push(priority); }
  if (search)   { sql += ' AND (t.title LIKE ? OR t.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY t.created_at DESC';
  res.json(await db.prepare(sql).all(...params));
});

app.get('/api/tickets/:id', auth, async (req, res) => {
  const ticket = await db.prepare(`
    SELECT t.*, o.name as org_name, u.name as assigned_name, c.name as creator_name
    FROM tickets t
    LEFT JOIN organizations o ON t.org_id = o.id
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users c ON t.created_by = c.id
    WHERE t.id = ?`).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (!sameOrgOrStaff(req, ticket.org_id)) return res.status(403).json({ error: 'No tienes permiso para ver este ticket' });

  const comments = await db.prepare(`
    SELECT tc.*, u.name as author FROM ticket_comments tc
    JOIN users u ON tc.user_id = u.id
    WHERE tc.ticket_id = ? ORDER BY tc.created_at ASC`).all(req.params.id);

  res.json({ ...ticket, comments });
});

app.post('/api/tickets', auth, async (req, res) => {
  const { title, description, priority, category, mitre_tactic } = req.body;
  let { org_id, assigned_to } = req.body;


  if (req.user.role === 'client') {
    org_id = req.user.org_id;
    assigned_to = null;
  }

  const result = await db.prepare(`
    INSERT INTO tickets (title,description,priority,category,mitre_tactic,org_id,assigned_to,created_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(title, description, priority, category, mitre_tactic||null, org_id||null, assigned_to||null, req.user.id);

  const ticketId = result.lastInsertRowid;
  res.status(201).json({ id: ticketId, message: 'Ticket created' });

  if (odoo.isEnabled()) {
    try {
      const org = org_id ? await db.prepare('SELECT name FROM organizations WHERE id=?').get(org_id) : null;
      const odooId = await odoo.createHelpdeskTicket({ title, description, priority, org_name: org?.name });
      if (odooId) await db.prepare('UPDATE tickets SET odoo_id=? WHERE id=?').run(odooId, ticketId);
    } catch (err) {
      console.error('[Odoo] No se pudo sincronizar el ticket', ticketId, '-', err.message);
    }
  }
});

app.patch('/api/tickets/:id', auth, requireRole('admin', 'agent'), async (req, res) => {
  const { status, priority, assigned_to, mitre_tactic } = req.body;
  const fields = []; const params = [];
  if (status)      { fields.push('status=?');      params.push(status); }
  if (priority)    { fields.push('priority=?');    params.push(priority); }
  if (assigned_to) { fields.push('assigned_to=?'); params.push(assigned_to); }
  if (mitre_tactic !== undefined) { fields.push('mitre_tactic=?'); params.push(mitre_tactic); }
  if (status === 'resolved') fields.push("resolved_at=datetime('now')");
  fields.push("updated_at=datetime('now')");
  params.push(req.params.id);
  await db.prepare(`UPDATE tickets SET ${fields.join(',')} WHERE id=?`).run(...params);
  res.json({ message: 'Ticket updated' });

  if (odoo.isEnabled()) {
    try {
      const ticket = await db.prepare('SELECT odoo_id FROM tickets WHERE id=?').get(req.params.id);
      if (ticket?.odoo_id) {
        const odooFields = {};
        if (priority) odooFields.priority = { low:'0', medium:'1', high:'2', critical:'3' }[priority];
        // Nota: sincronizar el "stage" (columna kanban: Nuevo/En progreso/Resuelto)
        // requiere el ID real de esa etapa en TU equipo de Helpdesk en Odoo, que es
        // distinto en cada instalación. Ver README → "Sincronizar etapas" para
        // cómo obtenerlo y activarlo con una línea de código.
        if (Object.keys(odooFields).length) await odoo.updateHelpdeskTicket(ticket.odoo_id, odooFields);
      }
    } catch (err) {
      console.error('[Odoo] No se pudo actualizar el ticket', req.params.id, '-', err.message);
    }
  }
});

app.post('/api/tickets/:id/comments', auth, async (req, res) => {
  const ticket = await db.prepare('SELECT org_id FROM tickets WHERE id=?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (!sameOrgOrStaff(req, ticket.org_id)) return res.status(403).json({ error: 'No tienes permiso para comentar en este ticket' });

  await db.prepare('INSERT INTO ticket_comments (ticket_id,user_id,comment) VALUES (?,?,?)').run(req.params.id, req.user.id, req.body.comment);
  res.status(201).json({ message: 'Comment added' });

  if (odoo.isEnabled()) {
    try {
      const ticket = await db.prepare('SELECT odoo_id FROM tickets WHERE id=?').get(req.params.id);
      if (ticket?.odoo_id) {
        await odoo.addHelpdeskComment(ticket.odoo_id, req.body.comment, req.user.name);
      }
    } catch (err) {
      console.error('[Odoo] No se pudo sincronizar el comentario del ticket', req.params.id, '-', err.message);
    }
  }
});

// ── ORGANIZATIONS ─────────────────────────────────────────────
// Solo staff. Un cliente no necesita ver el directorio completo de
// organizaciones — solo la suya, que ya trae en su propio JWT (org_id).
app.get('/api/organizations', auth, requireRole('admin', 'agent'), async (req, res) => {
  const orgs = await db.prepare(`
    SELECT o.*, COUNT(t.id) as ticket_count,
           (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) as user_count
    FROM organizations o LEFT JOIN tickets t ON t.org_id = o.id
    GROUP BY o.id ORDER BY o.created_at DESC`).all();
  res.json(orgs);
});

app.post('/api/organizations', auth, requireRole('admin', 'agent'), async (req, res) => {
  const { name, industry, contact, email, phone } = req.body;
  const result = await db.prepare('INSERT INTO organizations (name,industry,contact,email,phone) VALUES (?,?,?,?,?)').run(name, industry, contact, email, phone);
  res.status(201).json({ id: result.lastInsertRowid, message: 'Organization created' });
});

app.patch('/api/organizations/:id', auth, requireRole('admin', 'agent'), async (req, res) => {
  const { name, industry, contact, email, phone, status } = req.body;
  await db.prepare('UPDATE organizations SET name=?,industry=?,contact=?,email=?,phone=?,status=? WHERE id=?').run(name, industry, contact, email, phone, status, req.params.id);
  res.json({ message: 'Organization updated' });
});

// ── EBC EVENTS ───────────────────────────────────────────────
app.get('/api/events', auth, async (req, res) => {
  let sql = `
    SELECT e.*, o.name as org_name,
           COUNT(p.id) as registered_count,
           MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) as joined
    FROM ebc_events e
    LEFT JOIN organizations o ON e.org_id = o.id
    LEFT JOIN ebc_participants p ON p.event_id = e.id`;
  const params = [req.user.id];
  // Un cliente ve las sesiones agendadas para su organización
  // y las sesiones abiertas (sin organización asignada).
  if (req.user.role === 'client') {
    sql += ' WHERE (e.org_id = ? OR e.org_id IS NULL)';
    params.push(req.user.org_id);
  }
  sql += ' GROUP BY e.id ORDER BY e.date DESC';
  res.json(await db.prepare(sql).all(...params));
});

app.get('/api/events/:id', auth, async (req, res) => {
  const event = await db.prepare(`
    SELECT e.*, o.name as org_name FROM ebc_events e
    LEFT JOIN organizations o ON e.org_id = o.id WHERE e.id=?`).get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!canSeeEvent(req, event)) return res.status(403).json({ error: 'No tienes permiso para ver esta sesión' });
  let participants = await db.prepare('SELECT * FROM ebc_participants WHERE event_id=?').all(req.params.id);
  const joined = participants.some(p => p.user_id === req.user.id);
  // En una sesión abierta, un cliente solo ve a los participantes de su propia empresa.
  if (req.user.role === 'client') {
    const me = await db.prepare('SELECT company FROM users WHERE id=?').get(req.user.id);
    participants = participants.filter(p => p.user_id === req.user.id ||
      (me?.company && (p.company || '').toLowerCase() === me.company.toLowerCase()));
  }
  res.json({ ...event, participants, joined });
});

app.post('/api/events', auth, requireRole('admin', 'agent'), async (req, res) => {
  const { title, description, date, location, org_id, capacity } = req.body;
  const result = await db.prepare('INSERT INTO ebc_events (title,description,date,location,org_id,capacity) VALUES (?,?,?,?,?,?)').run(title, description, date, location, org_id||null, capacity||20);
  res.status(201).json({ id: result.lastInsertRowid, message: 'Event created' });
});

app.post('/api/events/:id/participants', auth, async (req, res) => {
  let { name, email, company, role } = req.body;
  const event = await db.prepare('SELECT capacity, org_id FROM ebc_events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!canSeeEvent(req, event)) return res.status(403).json({ error: 'No tienes permiso para registrar participantes en esta sesión' });
  if (!name || !email) return res.status(400).json({ error: 'Nombre y correo son obligatorios' });
  // Un cliente siempre registra a gente de SU empresa.
  if (req.user.role === 'client') company = (await db.prepare('SELECT company FROM users WHERE id=?').get(req.user.id))?.company;
  const count = (await db.prepare('SELECT COUNT(*) as c FROM ebc_participants WHERE event_id=?').get(req.params.id)).c;
  if (count >= event.capacity) return res.status(400).json({ error: 'El evento ya está lleno' });
  if (await db.prepare('SELECT id FROM ebc_participants WHERE event_id=? AND lower(email)=lower(?)').get(req.params.id, email))
    return res.status(409).json({ error: 'Ese correo ya está registrado en esta sesión' });
  await db.prepare('INSERT INTO ebc_participants (event_id,name,email,company,role) VALUES (?,?,?,?,?)').run(req.params.id, name, email, company, role);
  res.status(201).json({ message: 'Participant registered' });
});

// Cliente: inscribirse a sí mismo a una sesión EBC con los datos de su cuenta.
app.post('/api/events/:id/join', auth, async (req, res) => {
  const event = await db.prepare('SELECT id, capacity, org_id, status FROM ebc_events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!canSeeEvent(req, event)) return res.status(403).json({ error: 'No tienes permiso para inscribirte a esta sesión' });
  if (event.status !== 'scheduled') return res.status(400).json({ error: 'Esta sesión ya no acepta inscripciones' });
  const me = await db.prepare('SELECT id, name, email, company FROM users WHERE id=?').get(req.user.id);
  if (await db.prepare('SELECT id FROM ebc_participants WHERE event_id=? AND (user_id=? OR lower(email)=lower(?))').get(event.id, me.id, me.email))
    return res.status(409).json({ error: 'Ya estás inscrito en esta sesión' });
  const count = (await db.prepare('SELECT COUNT(*) as c FROM ebc_participants WHERE event_id=?').get(event.id)).c;
  if (count >= event.capacity) return res.status(400).json({ error: 'El evento ya está lleno' });
  await db.prepare('INSERT INTO ebc_participants (event_id,name,email,company,role,user_id) VALUES (?,?,?,?,?,?)')
    .run(event.id, me.name, me.email, me.company, (req.body && req.body.role) || null, me.id);
  res.status(201).json({ message: 'Inscripción registrada' });
});

app.patch('/api/events/:id', auth, requireRole('admin', 'agent'), async (req, res) => {
  const { status } = req.body;
  await db.prepare('UPDATE ebc_events SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ message: 'Event updated' });
});

// ── USERS ─────────────────────────────────────────────────────
// Solo staff. La lista completa de usuarios (incluyendo otros clientes)
// no debe ser visible para un cliente.
app.get('/api/users', auth, requireRole('admin', 'agent'), async (req, res) => {
  // Incluye la organización de cada usuario y las sesiones EBC a las que está inscrito
  // (por su cuenta o porque alguien de su empresa lo registró con su correo).
  const users = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.company, u.org_id, u.created_at, u.status, u.is_leader, u.email_verified,
           o.name AS org_name, o.status AS org_status,
           (SELECT GROUP_CONCAT(e.title, ' | ')
              FROM ebc_participants p JOIN ebc_events e ON e.id = p.event_id
             WHERE p.user_id = u.id OR lower(p.email) = lower(u.email)) AS events
    FROM users u
    LEFT JOIN organizations o ON o.id = u.org_id
    ORDER BY (u.status = 'pending') DESC, u.created_at DESC`).all();
  res.json(users);
});

// ── CONTACT (public site → backend) ────────────────────────────
// Público: cualquier visitante del sitio puede enviar el formulario, sin login.
app.post('/api/contact', async (req, res) => {
  const { nombre, empresa, email, telefono, motivo, mensaje } = req.body;
  if (!nombre || !email || !mensaje)
    return res.status(400).json({ error: 'nombre, email y mensaje son obligatorios' });

  const info = await db.prepare(
    `INSERT INTO contact_requests (nombre, empresa, email, telefono, motivo, mensaje)
     VALUES (?,?,?,?,?,?)`
  ).run(nombre, empresa || null, email, telefono || null, motivo || null, mensaje);

  res.status(201).json({ id: info.lastInsertRowid, message: 'Solicitud recibida' });

  // El correo se manda DESPUÉS de responder, para no hacer esperar al
  // visitante del sitio. Si falla (SMTP mal configurado, sin internet, etc.)
  // el lead ya quedó guardado en la base de datos de todas formas.
  try {
    await mailer.sendContactNotification({ nombre, empresa, email, telefono, motivo, mensaje });
  } catch (err) {
    console.error('[Mailer] No se pudo enviar el correo de la solicitud', info.lastInsertRowid, '-', err.message);
  }
});

// Protegido: solo el equipo interno ve/gestiona los leads recibidos.
app.get('/api/contact', auth, requireRole('admin', 'agent'), async (req, res) => {
  const requests = await db.prepare('SELECT * FROM contact_requests ORDER BY created_at DESC').all();
  res.json(requests);
});

app.patch('/api/contact/:id', auth, requireRole('admin', 'agent'), async (req, res) => {
  const { status } = req.body;
  await db.prepare('UPDATE contact_requests SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// ── BOT DE TELEGRAM → HELP DESK ──────────────────────────────
// El bot (bot_zevorus.py) crea tickets aquí. No usa login: se protege con
// una clave compartida BOT_SECRET (en backend/.env y en las variables de Render).
// Si BOT_SECRET no está configurado, esta ruta queda apagada.
function safeEqual(a = '', b = '') {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

app.post('/api/bot/tickets', async (req, res) => {
  const secret = process.env.BOT_SECRET;
  if (!secret) return res.status(503).json({ error: 'El bot no está configurado (falta BOT_SECRET)' });
  if (!safeEqual(req.get('x-bot-secret'), secret)) return res.status(401).json({ error: 'Clave del bot incorrecta' });

  const empresa     = String(req.body.empresa || '').trim().slice(0, 120);
  const titulo      = String(req.body.titulo || '').trim().slice(0, 200);
  const descripcion = String(req.body.descripcion || '').trim().slice(0, 4000);
  const evidencia   = String(req.body.evidencia || '').trim().slice(0, 500);
  const usuario     = String(req.body.usuario_telegram || '').trim().slice(0, 120);
  if (!empresa || !titulo) return res.status(400).json({ error: 'empresa y titulo son obligatorios' });

  // Empresa: si ya existe se usa; si no, se registra como prospecto.
  let org = await db.prepare('SELECT id, name FROM organizations WHERE lower(name) = lower(?)').get(empresa);
  if (!org) {
    const id = (await db.prepare("INSERT INTO organizations (name, status) VALUES (?, 'prospect')").run(empresa)).lastInsertRowid;
    org = { id, name: empresa };
  }

  // Se asigna al agente activo con menos tickets abiertos.
  const agent = await db.prepare(`
    SELECT u.id FROM users u
    WHERE u.role = 'agent' AND u.status = 'active'
    ORDER BY (SELECT COUNT(*) FROM tickets t WHERE t.assigned_to = u.id AND t.status IN ('open','in_progress')), u.id
    LIMIT 1`).get();

  const fullDescription = [
    descripcion || 'Sin descripción adicional',
    '',
    '— Ticket creado desde el bot de Telegram —',
    usuario   ? `Usuario de Telegram: ${usuario}` : null,
    evidencia ? `Evidencia: ${evidencia}` : 'Evidencia: sin archivo adjunto',
  ].filter(l => l !== null).join('\n');

  const ticketId = (await db.prepare(`
    INSERT INTO tickets (title, description, priority, category, org_id, assigned_to, created_by)
    VALUES (?, ?, 'medium', 'Service Request', ?, ?, NULL)`)
    .run(titulo, fullDescription, org.id, agent ? agent.id : null)).lastInsertRowid;

  res.status(201).json({ id: Number(ticketId), empresa: org.name, message: 'Ticket creado' });

  if (odoo.isEnabled()) {
    try {
      const odooId = await odoo.createHelpdeskTicket({ title: titulo, description: fullDescription, priority: 'medium', org_name: org.name });
      if (odooId) await db.prepare('UPDATE tickets SET odoo_id=? WHERE id=?').run(odooId, ticketId);
    } catch (err) { console.error('[Odoo] No se pudo sincronizar el ticket del bot', ticketId, '-', err.message); }
  }
});

// ── ODOO INTEGRATION ─────────────────────────────────────────
app.get('/api/odoo/status', auth, requireRole('admin', 'agent'), async (req, res) => {
  res.json(await odoo.checkConnection());
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
// Espera a que la base de datos esté lista (tablas, datos iniciales) antes de abrir el servidor.
db.ready
  .then(() => {
    if (!mailer.isEnabled()) console.warn('⚠️  SMTP no configurado: no se enviarán correos y las cuentas nuevas se activan sin confirmar el correo');
  })
  .then(() => app.listen(PORT, () => console.log(`✅  Zevorus API running on http://localhost:${PORT}`)))
  .catch(err => { console.error('[DB] No se pudo inicializar la base de datos:', err); process.exit(1); });
