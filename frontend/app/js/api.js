// Ruta relativa: funciona automáticamente sea que abras el sitio en
// localhost:3000, 127.0.0.1:3000, o cuando lo despliegues en un dominio real.
// IMPORTANTE: esto solo funciona si abres la página desde el propio backend
// (http://localhost:3000/app/), NO desde Live Server (127.0.0.1:5500), porque
// Live Server sirve los archivos por su cuenta sin pasar por el servidor Node.
const API_BASE = '/api';

const api = {
  token: null,

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  },

  async _req(method, path, body) {
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method, headers: this._headers(),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Revisa tu internet e intenta de nuevo.');
    }

    // Si el servidor responde algo que no es JSON (error interno, página caída), no rompemos la app.
    let data = {};
    try { data = await res.json(); } catch { /* respuesta vacía o HTML */ }

    // Sesión vencida o cuenta desactivada: cerrar sesión y volver al login.
    if (res.status === 401 && this.token) {
      if (typeof sessionExpired === 'function') sessionExpired(data.error);
      throw new Error(data.error || 'Tu sesión expiró. Vuelve a iniciar sesión.');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Hubo un problema. Intenta de nuevo en un momento.'),
                                     { code: data.code, data, status: res.status });
    return data;
  },

  get:    (path)        => api._req('GET',   path),
  post:   (path, body)  => api._req('POST',  path, body),
  patch:  (path, body)  => api._req('PATCH', path, body),
  delete: (path)        => api._req('DELETE', path),

  login: (email, password) => api.post('/login', { email, password }),

  // Stats
  stats: () => api.get('/stats'),

  // Tickets
  tickets:       (q = {}) => api.get('/tickets?' + new URLSearchParams(q).toString()),
  ticket:        (id)     => api.get(`/tickets/${id}`),
  createTicket:  (data)   => api.post('/tickets', data),
  updateTicket:  (id, d)  => api.patch(`/tickets/${id}`, d),
  addComment:    (id, c)  => api.post(`/tickets/${id}/comments`, { comment: c }),

  // Organizations
  orgs:       ()     => api.get('/organizations'),
  createOrg:  (data) => api.post('/organizations', data),
  updateOrg:  (id,d) => api.patch(`/organizations/${id}`, d),

  // Events
  events:            ()      => api.get('/events'),
  event:             (id)    => api.get(`/events/${id}`),
  createEvent:       (data)  => api.post('/events', data),
  updateEvent:       (id, d) => api.patch(`/events/${id}`, d),
  addParticipant:    (id, d) => api.post(`/events/${id}/participants`, d),
  joinEvent:         (id, d) => api.post(`/events/${id}/join`, d || {}),

  // Users
  users:      ()     => api.get('/users'),
  createUser: (data) => api.post('/users', data),

  // Registro público (crea cuenta de cliente)
  register: (data) => api.post('/register', data),

  // Recuperar contraseña
  forgotPassword: (email)           => api.post('/forgot-password', { email }),
  resetPassword:  (token, password) => api.post('/reset-password', { token, password }),

  // Confirmar correo
  verifyEmail:        (token) => api.post('/verify-email', { token }),
  resendVerification: (email) => api.post('/resend-verification', { email }),

  // Aprobación de cuentas / líder de empresa
  team:        ()   => api.get('/team'),
  approveUser: (id) => api.post(`/users/${id}/approve`),
  rejectUser:  (id) => api.delete(`/users/${id}`),
  makeLeader:  (id) => api.post(`/users/${id}/make-leader`),
};
