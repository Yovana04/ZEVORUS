// ─────────────────────────────────────────────────────────────
// Pruebas automáticas de la plataforma Zevorus
//
// Uso (desde la carpeta del proyecto):
//     cd backend && npm install && cd ..
//     node tests/run-tests.js
//
// Levanta el servidor con una base de datos TEMPORAL (no toca tus datos
// ni Turso), ejecuta los casos de prueba de cada módulo, mide tiempos de
// respuesta y al final imprime:
//   1) la tabla de resultados por módulo,
//   2) los tiempos promedio por operación,
//   3) las líneas listas para pegar en main.tex (Overleaf).
// También guarda todo en tests/resultados.txt
// ─────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'zevorus-test-'));
const PERF_RUNS = 10;
let serverLog = '';

// ── Utilidades ───────────────────────────────────────────────
async function call(method, url, { token, body } = {}) {
  const headers = {};
  if (body)  headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t0;
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, ms };
}
const get  = (u, o) => call('GET', u, o);
const post = (u, b, o = {}) => call('POST', u, { ...o, body: b });
const patch = (u, b, o = {}) => call('PATCH', u, { ...o, body: b });
const del  = (u, o) => call('DELETE', u, o);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Toma del log del servidor el último enlace enviado a un correo (modo prueba).
async function lastLink(kind, email) {
  await sleep(150);
  const re = new RegExp(`\\[${kind}\\] Enlace para ${email.replace(/[.+]/g, '\\$&')}: \\S+\\?(?:verify|reset)=([a-f0-9]+)`, 'g');
  let m, last = null;
  while ((m = re.exec(serverLog))) last = m[1];
  return last;
}

const results = {};      // módulo → [{ name, ok, detail }]
async function test(module, name, fn) {
  (results[module] ||= []);
  try {
    const out = await fn();
    const ok = out === true || out === undefined;
    results[module].push({ name, ok, detail: ok ? '' : String(out) });
  } catch (err) {
    results[module].push({ name, ok: false, detail: err.message });
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); return true; };

// ── Arranque del servidor ───────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT, DB_PATH: path.join(TMP, 'test.db'), MAIL_DRY_RUN: '1', LOG_EMAIL_LINKS: '1',
                  JWT_SECRET: 'clave_solo_para_pruebas_1234567890', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
                  ODOO_URL: '', SMTP_USER: '', SMTP_PASS: '' };
    const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', 'backend'), env });
    const onData = d => { serverLog += d.toString(); if (serverLog.includes('running on')) resolve(srv); };
    srv.stdout.on('data', onData); srv.stderr.on('data', onData);
    srv.on('exit', c => reject(new Error('El servidor se cerró (código ' + c + '):\n' + serverLog)));
    setTimeout(() => reject(new Error('El servidor no arrancó a tiempo:\n' + serverLog)), 20000);
  });
}

async function login(email, password) {
  const r = await post('/api/login', { email, password });
  if (!r.data?.token) throw new Error(`No se pudo iniciar sesión con ${email}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

// Crea un cliente nuevo ya confirmado y devuelve su token.
async function newClient(name, email, company, password = 'Prueba#2026') {
  await post('/api/register', { name, email, company, password });
  const t = await lastLink('Verify', email);
  await post('/api/verify-email', { token: t });
  return login(email, password);
}

// ── Casos de prueba ─────────────────────────────────────────
async function run() {
  const admin = await login('pablo@zevorus.com', 'zevorus2026');
  const agent = await login('yovana@zevorus.com', 'zevorus2026');

  // ===== Autenticación y RBAC =====
  const A = 'Auth. and RBAC';
  await test(A, 'Rechaza contraseña sin mayúscula/número/símbolo', async () => {
    const r = await post('/api/register', { name: 'Débil', email: 'debil@acme.mx', company: 'Acme', password: 'abcdefgh' });
    return expect(r.status === 400, `status ${r.status}`);
  });
  await test(A, 'Registro válido pide confirmar el correo', async () => {
    const r = await post('/api/register', { name: 'Ana Líder', email: 'ana@acme.mx', company: 'Acme MX', password: 'Segura#2026' });
    return expect(r.status === 202 && r.data.verify, JSON.stringify(r.data));
  });
  await test(A, 'No permite entrar sin confirmar el correo', async () => {
    const r = await post('/api/login', { email: 'ana@acme.mx', password: 'Segura#2026' });
    return expect(r.status === 403 && r.data.code === 'EMAIL_NOT_VERIFIED', `status ${r.status}`);
  });
  await test(A, 'Reenvío del correo de confirmación', async () => {
    const r = await post('/api/resend-verification', { email: 'ana@acme.mx' });
    return expect(r.status === 200 && await lastLink('Verify', 'ana@acme.mx'), `status ${r.status}`);
  });
  await test(A, 'El enlace de confirmación activa la cuenta', async () => {
    const r = await post('/api/verify-email', { token: await lastLink('Verify', 'ana@acme.mx') });
    return expect(r.status === 200, JSON.stringify(r.data));
  });
  await test(A, 'Un enlace ya usado se rechaza', async () => {
    const r = await post('/api/verify-email', { token: await lastLink('Verify', 'ana@acme.mx') });
    return expect(r.status === 400, `status ${r.status}`);
  });
  await test(A, 'Login correcto devuelve sesión', async () => {
    const r = await post('/api/login', { email: 'ANA@acme.mx ', password: 'Segura#2026' });
    return expect(r.status === 200 && r.data.token, `status ${r.status}`);
  });
  await test(A, 'Contraseña incorrecta indica intentos restantes', async () => {
    const r = await post('/api/login', { email: 'ana@acme.mx', password: 'Mala#0000' });
    return expect(r.status === 401 && /quedan 4/.test(r.data.error), r.data.error);
  });
  await test(A, 'Bloqueo tras 5 intentos fallidos', async () => {
    let r; for (let i = 0; i < 4; i++) r = await post('/api/login', { email: 'ana@acme.mx', password: 'Mala#0000' });
    const r2 = await post('/api/login', { email: 'ana@acme.mx', password: 'Segura#2026' });
    return expect(r.status === 429 && r2.status === 429, `status ${r.status}/${r2.status}`);
  });
  await test(A, 'Recuperar contraseña: rechaza contraseña débil', async () => {
    await post('/api/forgot-password', { email: 'ana@acme.mx' });
    const r = await post('/api/reset-password', { token: await lastLink('Reset', 'ana@acme.mx'), password: 'debil123' });
    return expect(r.status === 400, `status ${r.status}`);
  });
  await test(A, 'Recuperar contraseña: cambia y desbloquea', async () => {
    const r = await post('/api/reset-password', { token: await lastLink('Reset', 'ana@acme.mx'), password: 'Nueva$2026' });
    const l = await post('/api/login', { email: 'ana@acme.mx', password: 'Nueva$2026' });
    return expect(r.status === 200 && l.status === 200, `status ${r.status}/${l.status}`);
  });
  await test(A, 'La contraseña anterior ya no funciona', async () => {
    const r = await post('/api/login', { email: 'ana@acme.mx', password: 'Segura#2026' });
    return expect(r.status === 401, `status ${r.status}`);
  });
  await test(A, 'Correo inexistente no revela si existe', async () => {
    const a = await post('/api/forgot-password', { email: 'noexiste@x.mx' });
    const b = await post('/api/forgot-password', { email: 'ana@acme.mx' });
    return expect(a.status === 200 && a.data.message === b.data.message, 'mensajes distintos');
  });
  await test(A, 'Sin sesión → 401', async () => expect((await get('/api/tickets')).status === 401, 'no 401'));
  await test(A, 'Token falso → 401', async () => expect((await get('/api/tickets', { token: 'a.b.c' })).status === 401, 'no 401'));
  const anaTok = await login('ana@acme.mx', 'Nueva$2026');
  await test(A, 'Cliente no ve el directorio de organizaciones (403)', async () =>
    expect((await get('/api/organizations', { token: anaTok })).status === 403, 'no 403'));
  await test(A, 'Cliente no ve la lista de usuarios (403)', async () =>
    expect((await get('/api/users', { token: anaTok })).status === 403, 'no 403'));
  await test(A, 'Agente sí accede a organizaciones', async () =>
    expect((await get('/api/organizations', { token: agent })).status === 200, 'no 200'));
  await test(A, 'Registro en empresa existente queda pendiente', async () => {
    await post('/api/register', { name: 'Beto', email: 'beto@acme.mx', company: 'acme mx', password: 'Segura#2026' });
    await post('/api/verify-email', { token: await lastLink('Verify', 'beto@acme.mx') });
    const r = await post('/api/login', { email: 'beto@acme.mx', password: 'Segura#2026' });
    return expect(r.status === 403 && /pendiente/.test(r.data.error), `status ${r.status}`);
  });
  await test(A, 'Líder ve la solicitud y la aprueba', async () => {
    const team = (await get('/api/team', { token: anaTok })).data;
    const beto = team.find(m => m.email === 'beto@acme.mx' && m.status === 'pending');
    const r = await post(`/api/users/${beto.id}/approve`, {}, { token: anaTok });
    const l = await post('/api/login', { email: 'beto@acme.mx', password: 'Segura#2026' });
    return expect(r.status === 200 && l.status === 200, `status ${r.status}/${l.status}`);
  });
  await test(A, 'Un miembro que no es líder no ve "Mi equipo"', async () => {
    const beto = await login('beto@acme.mx', 'Segura#2026');
    return expect((await get('/api/team', { token: beto })).status === 403, 'no 403');
  });
  await test(A, 'Intento de colarse a otra empresa queda pendiente', async () => {
    await post('/api/register', { name: 'Intruso', email: 'intruso@x.mx', company: 'Grupo Alfa', password: 'Segura#2026' });
    await post('/api/verify-email', { token: await lastLink('Verify', 'intruso@x.mx') });
    const r = await post('/api/login', { email: 'intruso@x.mx', password: 'Segura#2026' });
    return expect(r.status === 403, `status ${r.status}`);
  });
  await test(A, 'Líder de otra empresa no puede aprobarlo', async () => {
    const intr = (await get('/api/users', { token: admin })).data.find(u => u.email === 'intruso@x.mx');
    return expect((await post(`/api/users/${intr.id}/approve`, {}, { token: anaTok })).status === 403, 'no 403');
  });
  await test(A, 'Staff rechaza la solicitud', async () => {
    const intr = (await get('/api/users', { token: admin })).data.find(u => u.email === 'intruso@x.mx');
    return expect((await del(`/api/users/${intr.id}`, { token: admin })).status === 200, 'no 200');
  });

  // ===== Help Desk =====
  const H = 'Help Desk';
  const carlos = await login('carlos@grupoalfa.mx', 'zevorus2026');
  let staffTicket, clientTicket;
  await test(H, 'Agente crea ticket con táctica MITRE ATT&CK', async () => {
    const r = await post('/api/tickets', { title: 'Prueba incidente', description: 'desc', priority: 'high', category: 'Incident',
                                           mitre_tactic: 'Credential Access', org_id: 1 }, { token: agent });
    staffTicket = r.data.id;
    const t = (await get(`/api/tickets/${staffTicket}`, { token: agent })).data;
    return expect(r.status === 201 && t.mitre_tactic === 'Credential Access', `status ${r.status}`);
  });
  await test(H, 'Cliente crea ticket y queda en su empresa', async () => {
    const r = await post('/api/tickets', { title: 'Ayuda VPN', description: 'no conecta', priority: 'medium', category: 'Service Request',
                                           org_id: 2 }, { token: anaTok });
    clientTicket = r.data.id;
    const t = (await get(`/api/tickets/${clientTicket}`, { token: admin })).data;
    return expect(t.org_name === 'Acme MX', `org ${t.org_name}`);
  });
  await test(H, 'Cliente solo ve tickets de su empresa', async () => {
    const list = (await get('/api/tickets', { token: anaTok })).data;
    return expect(list.length > 0 && list.every(t => t.org_name === 'Acme MX'), 've tickets ajenos');
  });
  await test(H, 'Cliente no puede abrir ticket de otra empresa (403)', async () =>
    expect((await get(`/api/tickets/${staffTicket}`, { token: anaTok })).status === 403, 'no 403'));
  await test(H, 'Agregar comentario', async () => {
    await post(`/api/tickets/${clientTicket}/comments`, { comment: 'Revisando' }, { token: agent });
    const t = (await get(`/api/tickets/${clientTicket}`, { token: anaTok })).data;
    return expect(t.comments.some(c => c.comment === 'Revisando'), 'sin comentario');
  });
  await test(H, 'Cliente no puede comentar ticket ajeno (403)', async () =>
    expect((await post(`/api/tickets/${staffTicket}/comments`, { comment: 'x' }, { token: anaTok })).status === 403, 'no 403'));
  await test(H, 'Asignar agente y cambiar estado', async () => {
    await patch(`/api/tickets/${clientTicket}`, { status: 'in_progress', assigned_to: 2 }, { token: agent });
    const t = (await get(`/api/tickets/${clientTicket}`, { token: agent })).data;
    return expect(t.status === 'in_progress' && t.assigned_to === 2, JSON.stringify([t.status, t.assigned_to]));
  });
  await test(H, 'Resolver registra fecha de resolución', async () => {
    await patch(`/api/tickets/${clientTicket}`, { status: 'resolved' }, { token: agent });
    const t = (await get(`/api/tickets/${clientTicket}`, { token: agent })).data;
    return expect(t.status === 'resolved' && t.resolved_at, 'sin resolved_at');
  });
  await test(H, 'Cliente no puede modificar tickets (403)', async () =>
    expect((await patch(`/api/tickets/${clientTicket}`, { status: 'closed' }, { token: anaTok })).status === 403, 'no 403'));
  await test(H, 'Filtrar por estado y prioridad', async () => {
    const l = (await get('/api/tickets?status=open&priority=critical', { token: agent })).data;
    return expect(l.every(t => t.status === 'open' && t.priority === 'critical'), 'filtro incorrecto');
  });
  await test(H, 'Búsqueda por texto', async () => {
    const l = (await get('/api/tickets?search=VPN', { token: agent })).data;
    return expect(l.length > 0 && l.every(t => /VPN/i.test(t.title + t.description)), 'búsqueda incorrecta');
  });

  // ===== Organizations =====
  const O = 'Organizations';
  let orgId;
  await test(O, 'Crear organización', async () => {
    const r = await post('/api/organizations', { name: 'Org Prueba', industry: 'Retail', contact: 'X', email: 'x@o.mx', phone: '1' }, { token: agent });
    orgId = r.data.id; return expect(r.status === 201, `status ${r.status}`);
  });
  await test(O, 'Editar organización', async () => {
    await patch(`/api/organizations/${orgId}`, { name: 'Org Prueba', industry: 'Finance', contact: 'X', email: 'x@o.mx', phone: '1', status: 'active' }, { token: agent });
    const o = (await get('/api/organizations', { token: agent })).data.find(o => o.id === orgId);
    return expect(o.industry === 'Finance', o.industry);
  });
  await test(O, 'Conteo de tickets por organización', async () => {
    const o = (await get('/api/organizations', { token: agent })).data.find(o => o.name === 'Acme MX');
    return expect(o.ticket_count === 1 && o.user_count === 2, JSON.stringify([o.ticket_count, o.user_count]));
  });
  await test(O, 'Registro de empresa nueva crea la organización', async () => {
    const o = (await get('/api/organizations', { token: agent })).data.find(o => o.name === 'Acme MX');
    return expect(o && o.status === 'prospect', 'no existe');
  });
  await test(O, 'Cliente no puede crear organizaciones (403)', async () =>
    expect((await post('/api/organizations', { name: 'X' }, { token: anaTok })).status === 403, 'no 403'));

  // ===== EBC Events =====
  const E = 'EBC Events';
  let openEv, smallEv;
  await test(E, 'Crear sesión EBC abierta', async () => {
    const r = await post('/api/events', { title: 'Sesión abierta prueba', date: '2026-12-01', capacity: 3 }, { token: agent });
    openEv = r.data.id; return expect(r.status === 201, `status ${r.status}`);
  });
  await test(E, 'Cliente ve sesiones de su empresa y abiertas, no ajenas', async () => {
    const l = (await get('/api/events', { token: anaTok })).data;
    return expect(l.some(e => e.id === openEv) && l.every(e => e.org_id == null || e.org_name === 'Acme MX'), 've ajenas');
  });
  await test(E, 'Cliente no puede abrir sesión de otra empresa (403)', async () =>
    expect((await get('/api/events/1', { token: anaTok })).status === 403, 'no 403'));
  await test(E, 'Inscribirse a una sesión', async () => {
    const r = await post(`/api/events/${openEv}/join`, {}, { token: anaTok });
    const e = (await get('/api/events', { token: anaTok })).data.find(e => e.id === openEv);
    return expect(r.status === 201 && e.joined === 1, `status ${r.status}`);
  });
  await test(E, 'No permite inscribirse dos veces', async () =>
    expect((await post(`/api/events/${openEv}/join`, {}, { token: anaTok })).status === 409, 'no 409'));
  await test(E, 'Registrar a otra persona de la empresa', async () =>
    expect((await post(`/api/events/${openEv}/participants`, { name: 'Ceci', email: 'ceci@acme.mx', role: 'CTO' }, { token: anaTok })).status === 201, 'no 201'));
  await test(E, 'Respeta el cupo máximo', async () => {
    await post(`/api/events/${openEv}/participants`, { name: 'Dan', email: 'dan@acme.mx' }, { token: agent });
    return expect((await post(`/api/events/${openEv}/participants`, { name: 'Eva', email: 'eva@acme.mx' }, { token: agent })).status === 400, 'no 400');
  });
  await test(E, 'Sesión completada no acepta inscripciones', async () => {
    smallEv = (await post('/api/events', { title: 'Pasada', date: '2026-01-01', capacity: 5 }, { token: agent })).data.id;
    await patch(`/api/events/${smallEv}`, { status: 'completed' }, { token: agent });
    return expect((await post(`/api/events/${smallEv}/join`, {}, { token: anaTok })).status === 400, 'no 400');
  });
  await test(E, 'Cliente no puede crear sesiones (403)', async () =>
    expect((await post('/api/events', { title: 'x', date: '2026-12-01' }, { token: anaTok })).status === 403, 'no 403'));

  // ===== Users =====
  const U = 'Users';
  await test(U, 'Admin crea un agente', async () =>
    expect((await post('/api/users', { name: 'Agente Nuevo', email: 'nuevo@zevorus.com', role: 'agent', password: 'Agente#2026' }, { token: admin })).status === 201, 'no 201'));
  await test(U, 'Agente no puede crear usuarios (403)', async () =>
    expect((await post('/api/users', { name: 'X', email: 'x@zevorus.com', role: 'agent', password: 'Agente#2026' }, { token: agent })).status === 403, 'no 403'));
  await test(U, 'Correo duplicado se rechaza (409)', async () =>
    expect((await post('/api/register', { name: 'X', email: 'ana@acme.mx', company: 'Y', password: 'Segura#2026' })).status === 409, 'no 409'));
  await test(U, 'Lista muestra empresa y sesiones EBC de cada usuario', async () => {
    const ana = (await get('/api/users', { token: admin })).data.find(u => u.email === 'ana@acme.mx');
    return expect(ana.org_name === 'Acme MX' && /Sesión abierta prueba/.test(ana.events || ''), JSON.stringify(ana));
  });
  await test(U, 'Equipo Zevorus registrado (10 agentes, sin Mirian)', async () => {
    const l = (await get('/api/users', { token: admin })).data;
    const agents = l.filter(u => u.role === 'agent' && u.email.endsWith('@zevorus.com') && u.email !== 'nuevo@zevorus.com');
    return expect(agents.length === 10 && !l.some(u => /mirian/i.test(u.email)), `agentes: ${agents.length}`);
  });

  // ===== Dashboard =====
  const D = 'Dashboard';
  await test(D, 'Indicadores coinciden con los tickets', async () => {
    const s = (await get('/api/stats', { token: agent })).data;
    const all = (await get('/api/tickets', { token: agent })).data;
    return expect(s.totalTickets === all.length && s.openTickets === all.filter(t => t.status === 'open').length, 'no coinciden');
  });
  await test(D, 'Distribución por prioridad y tácticas MITRE', async () => {
    const s = (await get('/api/stats', { token: agent })).data;
    return expect(Array.isArray(s.byPriority) && s.mitreStats.some(m => m.mitre_tactic === 'Credential Access'), 'faltan datos');
  });
  await test(D, 'Tickets recientes (máximo 5)', async () => {
    const s = (await get('/api/stats', { token: agent })).data;
    return expect(s.recentTickets.length === 5, `${s.recentTickets.length}`);
  });
  await test(D, 'Cliente no ve el dashboard (403)', async () =>
    expect((await get('/api/stats', { token: anaTok })).status === 403, 'no 403'));

  // ===== Sitio público y formulario =====
  const P = 'Public site and form';
  for (const page of ['/', '/Servicios.html', '/Nosotros.html', '/Contacto.html', '/Soporte.html', '/app/'])
    await test(P, `Página ${page} carga`, async () => expect((await get(page)).status === 200, 'no 200'));
  await test(P, 'Formulario de contacto guarda la solicitud', async () =>
    expect((await post('/api/contact', { nombre: 'Lead', empresa: 'X', email: 'lead@x.mx', mensaje: 'Hola' })).status === 201, 'no 201'));
  await test(P, 'Formulario rechaza campos obligatorios vacíos', async () =>
    expect((await post('/api/contact', { nombre: '', email: '', mensaje: '' })).status === 400, 'no 400'));
  await test(P, 'Solo el staff ve las solicitudes', async () => {
    const s = await get('/api/contact', { token: agent }); const c = await get('/api/contact', { token: anaTok });
    return expect(s.status === 200 && s.data.some(r => r.email === 'lead@x.mx') && c.status === 403, 'permisos incorrectos');
  });

  // ===== Integraciones =====
  const I = 'Integrations';
  await test(I, 'Odoo no configurado: los tickets se crean igual', async () =>
    expect((await post('/api/tickets', { title: 'Sin Odoo', description: 'd', priority: 'low', category: 'Incident' }, { token: agent })).status === 201, 'no 201'));
  await test(I, 'Endpoint de estado de Odoo responde sin romperse', async () =>
    expect((await get('/api/odoo/status', { token: agent })).status === 200, 'no 200'));
  await test(I, 'Correo de contacto falla sin afectar el registro', async () =>
    expect((await post('/api/contact', { nombre: 'L2', email: 'l2@x.mx', mensaje: 'm' })).status === 201, 'no 201'));
  await test(I, 'Correo de recuperación se genera aunque el envío no esté disponible', async () => {
    await post('/api/forgot-password', { email: 'beto@acme.mx' });
    return expect(await lastLink('Reset', 'beto@acme.mx'), 'sin enlace');
  });
  await test(I, 'Base de datos persiste tras reiniciar el servidor', async () => true);   // se valida abajo

  // ── Rendimiento ──────────────────────────────────────────
  const perf = {};
  async function measure(label, fn) {
    const times = [];
    for (let i = 0; i < PERF_RUNS; i++) times.push((await fn()).ms);
    perf[label] = times.reduce((a, b) => a + b, 0) / times.length;
  }
  await measure('Public site home page load', () => get('/'));
  await measure('Login (JWT issuance)', () => post('/api/login', { email: 'yovana@zevorus.com', password: 'zevorus2026' }));
  await measure('List tickets (Help Desk)', () => get('/api/tickets', { token: agent }));
  let n = 0;
  await measure('Create ticket', () => post('/api/tickets', { title: `Perf ${n++}`, description: 'd', priority: 'low', category: 'Incident' }, { token: agent }));
  await measure('List organizations with open-ticket count', () => get('/api/organizations', { token: agent }));
  let p = 0;
  const perfEv = (await post('/api/events', { title: 'Perf', date: '2026-12-01', capacity: 1000 }, { token: agent })).data.id;
  await measure('Register EBC participant', () => post(`/api/events/${perfEv}/participants`, { name: 'P', email: `p${p++}@x.mx` }, { token: agent }));
  let c = 0;
  await measure('Submit contact form', () => post('/api/contact', { nombre: 'P', email: `c${c++}@x.mx`, mensaje: 'm' }));
  return { perf, carlos };
}

// ── Reporte ─────────────────────────────────────────────────
function report(perf, persisted) {
  results['Integrations'].find(t => t.name.startsWith('Base de datos persiste')).ok = persisted;
  const lines = [];
  const out = s => { lines.push(s); console.log(s); };
  const order = ['Auth. and RBAC', 'Help Desk', 'Organizations', 'EBC Events', 'Users', 'Dashboard', 'Public site and form', 'Integrations'];
  const macro = { 'Auth. and RBAC': 'Auth', 'Help Desk': 'Help', 'Organizations': 'Org', 'EBC Events': 'Ebc',
                  'Users': 'Usr', 'Dashboard': 'Dash', 'Public site and form': 'Pub', 'Integrations': 'Int' };

  out('\n================ RESULTADOS ================');
  let tot = 0, okTot = 0;
  const failed = [];
  for (const m of order) {
    const list = results[m] || [];
    const ok = list.filter(t => t.ok).length;
    tot += list.length; okTot += ok;
    out(`${m.padEnd(24)} casos: ${String(list.length).padStart(3)}   aprobados: ${String(ok).padStart(3)}   fallidos: ${list.length - ok}`);
    list.filter(t => !t.ok).forEach(t => failed.push(`  ✗ [${m}] ${t.name} → ${t.detail}`));
  }
  out(`${'TOTAL'.padEnd(24)} casos: ${String(tot).padStart(3)}   aprobados: ${String(okTot).padStart(3)}   fallidos: ${tot - okTot}`);
  if (failed.length) { out('\nPruebas que fallaron:'); failed.forEach(out); }

  out(`\n========== TIEMPOS PROMEDIO (${PERF_RUNS} repeticiones) ==========`);
  for (const [k, v] of Object.entries(perf)) out(`${k.padEnd(44)} ${v.toFixed(1)} ms`);

  out('\n====== PEGA ESTO EN main.tex (reemplaza el bloque de la Tabla II) ======');
  for (const m of order) {
    const list = results[m] || [], ok = list.filter(t => t.ok).length, k = macro[m];
    out(`\\newcommand{\\tc${k}}{${list.length}}   \\newcommand{\\ok${k}}{${ok}}`);
  }
  out('\n====== Valores para la Tabla III (ms) ======');
  for (const [k, v] of Object.entries(perf)) out(`${k}: ${Math.round(v)}`);
  out(`\nPromedio de solicitudes por operación: ${PERF_RUNS}`);

  out('\n====== Detalle de cada caso ======');
  for (const m of order) for (const t of results[m] || []) out(`${t.ok ? '✓' : '✗'} [${m}] ${t.name}`);

  fs.writeFileSync(path.join(__dirname, 'resultados.txt'), lines.join('\n'));
  console.log('\nGuardado en tests/resultados.txt');
}

(async () => {
  let srv;
  try {
    srv = await startServer();
    const { perf } = await run();
    // Reinicia el servidor y comprueba que los datos siguen ahí.
    srv.removeAllListeners('exit'); srv.kill(); await sleep(500);
    serverLog = '';
    srv = await startServer();
    const admin = await login('pablo@zevorus.com', 'zevorus2026');
    const persisted = (await get('/api/users', { token: admin })).data.some(u => u.email === 'ana@acme.mx');
    report(perf, persisted);
  } catch (err) {
    console.error('Error al correr las pruebas:', err.message);
    process.exitCode = 1;
  } finally {
    if (srv) { srv.removeAllListeners('exit'); srv.kill(); }
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})();
