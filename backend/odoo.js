/**
 * Cliente de integración con Odoo (JSON-RPC).
 */

const ODOO_URL      = process.env.ODOO_URL || '';
const ODOO_DB       = process.env.ODOO_DB || '';
const ODOO_USERNAME = process.env.ODOO_USERNAME || '';
const ODOO_API_KEY  = process.env.ODOO_API_KEY || '';

// La integración es opcional: si no hay credenciales, todo lo demás
// de la plataforma sigue funcionando normal (Odoo queda "apagado").
const isEnabled = () => Boolean(ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_API_KEY);

let cachedUid = null;

async function rpcCall(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Math.floor(Math.random() * 1e9)
    })
  });

  const data = await res.json();
  if (data.error) {
    const msg = data.error.data?.message || data.error.message || 'Odoo RPC error';
    throw new Error(msg);
  }
  return data.result;
}

async function authenticate() {
  if (cachedUid) return cachedUid;
  const uid = await rpcCall('common', 'login', [ODOO_DB, ODOO_USERNAME, ODOO_API_KEY]);
  if (!uid) throw new Error('Odoo: credenciales inválidas (login devolvió false)');
  cachedUid = uid;
  return uid;
}

async function executeKw(model, method, args = [], kwargs = {}) {
  const uid = await authenticate();
  return rpcCall('object', 'execute_kw', [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs]);
}


const PRIORITY_MAP = { low: '0', medium: '1', high: '2', critical: '3' };

async function createHelpdeskTicket(ticket) {
  if (!isEnabled()) return null;

  const teamId = await getDefaultTeamId();

  const odooId = await executeKw('helpdesk.ticket', 'create', [{
    name: ticket.title,
    description: ticket.description || '',
    priority: PRIORITY_MAP[ticket.priority] || '1',
    team_id: teamId,
    partner_name: ticket.org_name || undefined,
  }]);

  return odooId;
}

async function updateHelpdeskTicket(odooId, fields) {
  if (!isEnabled() || !odooId) return null;
  return executeKw('helpdesk.ticket', 'write', [[odooId], fields]);
}

async function addHelpdeskComment(odooId, comment, authorName) {
  if (!isEnabled() || !odooId) return null;
  return executeKw('mail.message', 'create', [{
    model: 'helpdesk.ticket',
    res_id: odooId,
    body: `<b>${authorName}:</b> ${comment}`,
    message_type: 'comment'
  }]);
}
let cachedTeamId = null;
async function getDefaultTeamId() {
  if (cachedTeamId) return cachedTeamId;
  const teams = await executeKw('helpdesk.team', 'search_read', [[], ['id']], { limit: 1 });
  cachedTeamId = teams[0]?.id || false;
  return cachedTeamId;
}

async function checkConnection() {
  if (!isEnabled()) return { connected: false, reason: 'Odoo no está configurado (faltan variables de entorno)' };
  try {
    const uid = await authenticate();
    return { connected: true, uid, url: ODOO_URL, db: ODOO_DB };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

module.exports = {
  isEnabled,
  createHelpdeskTicket,
  updateHelpdeskTicket,
  addHelpdeskComment,
  checkConnection,
};
