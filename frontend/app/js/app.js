let currentPage = null;

const pageLoaders = {
  dashboard:     loadDashboard,
  tickets:       loadTickets,
  organizations: loadOrganizations,
  events:        loadEvents,
  users:         loadUsers,
  'my-tickets':  loadMyTickets,
  'my-events':   loadMyEvents,
  'my-team':     loadMyTeam,
};

const NAV_BY_ROLE = {
  admin: [
    { page: 'dashboard',     icon: 'chart-line',     label: 'Dashboard' },
    { page: 'tickets',       icon: 'ticket',         label: 'Help Desk', badge: 'badge-open' },
    { page: 'organizations', icon: 'building',       label: 'Organizations' },
    { page: 'events',        icon: 'calendar-days',  label: 'EBC Events' },
    { page: 'users',         icon: 'users',          label: 'Users' },
  ],
  agent: [
    { page: 'dashboard',     icon: 'chart-line',     label: 'Dashboard' },
    { page: 'tickets',       icon: 'ticket',         label: 'Help Desk', badge: 'badge-open' },
    { page: 'organizations', icon: 'building',       label: 'Organizations' },
    { page: 'events',        icon: 'calendar-days',  label: 'EBC Events' },
    { page: 'users',         icon: 'users',          label: 'Users' },
  ],
  client: [
    { page: 'my-tickets', icon: 'ticket',        label: 'Mis Tickets' },
    { page: 'my-events',  icon: 'calendar-days', label: 'Sesiones EBC' },
  ],
};

// Solo el líder de una empresa ve la sección para aprobar a su equipo.
const LEADER_NAV = { page: 'my-team', icon: 'user-check', label: 'Mi equipo' };

const DEFAULT_PAGE_BY_ROLE = { admin: 'dashboard', agent: 'dashboard', client: 'my-tickets' };

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  currentPage = page;

  if (pageLoaders[page]) pageLoaders[page]();
}


document.getElementById('sidebar-nav').addEventListener('click', e => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  e.preventDefault();
  navigate(item.dataset.page);
});

function renderSidebarNav(user) {
  const items = [...(NAV_BY_ROLE[user.role] || [])];
  if (user.role === 'client' && user.is_leader) items.push(LEADER_NAV);
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = items.map((item, i) => `
    <a href="#" class="nav-item${i === 0 ? ' active' : ''}" data-page="${item.page}">
      <i class="fa-solid fa-${item.icon}"></i><span>${item.label}</span>
      ${item.badge ? `<span class="badge" id="${item.badge}">0</span>` : ''}
    </a>`).join('');
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.classList.add('hidden');
  document.getElementById('login-info').classList.add('hidden');

  document.getElementById('resend-verify-box').classList.add('hidden');

  try {
    const res = await api.login(email, password);
    startSession(res);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    if (err.code === 'EMAIL_NOT_VERIFIED') showResendVerify(err.data.email || email);
  }
});

function startSession(res) {
  api.token = res.token;
  localStorage.setItem('zevorus_token', res.token);
  localStorage.setItem('zevorus_user',  JSON.stringify(res.user));
  showApp(res.user);
}

// ── Formularios de acceso (login, registro, olvidé, restablecer) ──
const AUTH_FORMS = ['login', 'register', 'forgot', 'reset'];

function showAuthForm(which) {
  AUTH_FORMS.forEach(f => document.getElementById(`${f}-form`).classList.toggle('hidden', f !== which));
  document.querySelectorAll('#login-screen .error-msg, #login-screen .info-msg').forEach(el => el.classList.add('hidden'));
}

function showMsg(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove('hidden');
}

document.getElementById('show-register').addEventListener('click', e => { e.preventDefault(); showAuthForm('register'); });
document.getElementById('show-login').addEventListener('click',    e => { e.preventDefault(); showAuthForm('login'); });
document.getElementById('show-forgot').addEventListener('click',   e => {
  e.preventDefault();
  document.getElementById('forgot-email').value = document.getElementById('login-email').value;
  showAuthForm('forgot');
});
document.querySelectorAll('.back-to-login').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showAuthForm('login'); }));

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const password  = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  if (password !== password2) return showMsg('register-error', 'Las contraseñas no coinciden');
  if (!passwordOk(password)) return showMsg('register-error', 'La contraseña no cumple los requisitos de la lista.');

  try {
    const res = await api.register({
      name:     document.getElementById('reg-name').value,
      company:  document.getElementById('reg-company').value,
      email:    document.getElementById('reg-email').value,
      password,
    });
    document.getElementById('register-form').reset();
    updatePwdRules('reg-password');
    showAuthForm('login');
    if (res.verify) {                                              // falta confirmar el correo
      document.getElementById('login-email').value = res.email;
      showMsg('login-info', res.message);
      return showResendVerify(res.email);
    }
    if (res.pending) return showMsg('login-info', res.message);   // empresa ya existe → espera aprobación
    startSession(res);
    ui.toast('¡Cuenta creada! Bienvenido/a');
  } catch (err) {
    showMsg('register-error', err.message);
  }
});

document.getElementById('forgot-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('forgot-btn');
  document.getElementById('forgot-error').classList.add('hidden');
  btn.disabled = true;
  try {
    const res = await api.forgotPassword(document.getElementById('forgot-email').value);
    showMsg('forgot-info', res.message);
    // Permite reenviar el correo pasados 60 segundos.
    cooldown(btn, '<i class="fa fa-rotate-right"></i> Reenviar enlace');
  } catch (err) {
    showMsg('forgot-error', err.message);
    btn.disabled = false;
  }
});

// ── Reenviar correo de confirmación ──────────────────────
function showResendVerify(email) {
  const box = document.getElementById('resend-verify-box');
  box.dataset.email = email;
  box.classList.remove('hidden');
}

document.getElementById('resend-verify-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const email = document.getElementById('resend-verify-box').dataset.email || document.getElementById('login-email').value;
  btn.disabled = true;
  try {
    const res = await api.resendVerification(email);
    document.getElementById('login-error').classList.add('hidden');
    showMsg('login-info', res.message);
    cooldown(btn, '<i class="fa fa-rotate-right"></i> Reenviar correo de confirmación');
  } catch (err) {
    showMsg('login-error', err.message);
    btn.disabled = false;
  }
});

// Deshabilita un botón 60 s con cuenta regresiva (evita mandar muchos correos seguidos).
function cooldown(btn, label, seconds = 60) {
  btn.disabled = true;
  let left = seconds;
  btn.textContent = `Puedes reenviar en ${left} s`;
  const t = setInterval(() => {
    left--;
    if (left <= 0) { clearInterval(t); btn.disabled = false; btn.innerHTML = label; }
    else btn.textContent = `Puedes reenviar en ${left} s`;
  }, 1000);
}

// ── Requisitos de contraseña (lista que se va palomeando) ─
const PWD_RULES = {
  len:   p => p.length >= 8,
  upper: p => /[A-Z]/.test(p),
  num:   p => /[0-9]/.test(p),
  sym:   p => /[^A-Za-z0-9]/.test(p),
};
const passwordOk = p => Object.values(PWD_RULES).every(fn => fn(p));

function updatePwdRules(inputId) {
  const p = document.getElementById(inputId).value;
  document.querySelectorAll(`#${inputId}-rules li`).forEach(li =>
    li.classList.toggle('ok', PWD_RULES[li.dataset.rule](p)));
}
['reg-password', 'reset-password'].forEach(id =>
  document.getElementById(id).addEventListener('input', () => updatePwdRules(id)));

document.getElementById('reset-form').addEventListener('submit', async e => {
  e.preventDefault();
  const password  = document.getElementById('reset-password').value;
  const password2 = document.getElementById('reset-password2').value;
  if (password !== password2) return showMsg('reset-error', 'Las contraseñas no coinciden');
  if (!passwordOk(password)) return showMsg('reset-error', 'La contraseña no cumple los requisitos de la lista.');
  const token = new URLSearchParams(location.search).get('reset');
  try {
    const res = await api.resetPassword(token, password);
    history.replaceState(null, '', location.pathname);   // quita el token de la barra de direcciones
    document.getElementById('reset-form').reset();
    showAuthForm('login');
    showMsg('login-info', res.message);
  } catch (err) {
    showMsg('reset-error', err.message);
  }
});

// ── Caducidad de la sesión ───────────────────────────────
function tokenExpired(token) {
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !exp || Date.now() >= exp * 1000;
  } catch { return true; }
}

function logout(message) {
  localStorage.removeItem('zevorus_token');
  localStorage.removeItem('zevorus_user');
  api.token = null;
  ui.closeModal();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  showAuthForm('login');
  if (message) showMsg('login-info', message);
}

function sessionExpired(message) {
  if (!api.token) return;               // ya se cerró
  logout(message || 'Tu sesión expiró. Vuelve a iniciar sesión.');
}

// Revisa cada minuto si el token ya venció (por si la pestaña se queda abierta).
setInterval(() => { if (api.token && tokenExpired(api.token)) sessionExpired(); }, 60 * 1000);

function showApp(user) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('sidebar-name').textContent = user.name;
  document.getElementById('sidebar-role').textContent = user.role === 'client' ? `Cliente — ${user.company || ''}` : user.role;
  document.getElementById('sidebar-avatar').textContent = user.name[0];

  renderSidebarNav(user);
  navigate(DEFAULT_PAGE_BY_ROLE[user.role] || 'my-tickets');
}

document.getElementById('logout-btn').addEventListener('click', () => logout());

(async function init() {
  // ¿Viene del enlace del correo para confirmar su cuenta?
  const verifyToken = new URLSearchParams(location.search).get('verify');
  if (verifyToken) {
    history.replaceState(null, '', location.pathname);
    localStorage.removeItem('zevorus_token');
    localStorage.removeItem('zevorus_user');
    showAuthForm('login');
    try { showMsg('login-info', (await api.verifyEmail(verifyToken)).message); }
    catch (err) { showMsg('login-error', err.message); }
    return;
  }

  // ¿Viene del enlace del correo para cambiar contraseña?
  if (new URLSearchParams(location.search).get('reset')) {
    localStorage.removeItem('zevorus_token');
    localStorage.removeItem('zevorus_user');
    return showAuthForm('reset');
  }

  const token = localStorage.getItem('zevorus_token');
  const user  = localStorage.getItem('zevorus_user');
  if (token && user) {
    if (tokenExpired(token)) return logout('Tu sesión expiró. Vuelve a iniciar sesión.');
    api.token = token;
    showApp(JSON.parse(user));
    // Refresca los datos del usuario (por si lo nombraron líder o cambió su empresa).
    api.get('/me').then(me => {
      const fresh = { ...JSON.parse(user), ...me };
      localStorage.setItem('zevorus_user', JSON.stringify(fresh));
      renderSidebarNav(fresh);
      document.querySelector(`[data-page="${currentPage}"]`)?.classList.add('active');
      document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === currentPage));
    }).catch(() => {});
  }
})();
