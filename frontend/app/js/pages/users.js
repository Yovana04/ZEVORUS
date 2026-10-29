async function loadUsers() {
  const el    = document.getElementById('page-users');
  const users = await api.users();

  const pending = users.filter(u => u.status === 'pending');
  const esc = t => (t || '').replace(/'/g, "\\'");

  const rows = users.map(u => `
    <tr class="${u.status === 'pending' ? 'pending-row' : ''}">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:28px;height:28px;font-size:11px">${u.name[0]}</div>
          <div>
            <div>${u.name} ${u.is_leader ? '<span class="pill resolved" style="font-size:10px">Líder</span>' : ''}</div>
            ${u.status === 'pending' && !u.email_verified ? `
              <div style="margin-top:6px"><span class="pill" style="background:var(--bg3);color:var(--text2)">Correo sin confirmar</span></div>`
            : u.status === 'pending' ? `
              <div style="display:flex;gap:6px;margin-top:6px">
                <span class="pill" style="background:#f59e0b25;color:#f59e0b">Pendiente</span>
                <span class="action-link" onclick="approveMember(${u.id}, loadUsers)">Aprobar</span>
                <span class="action-link" style="color:var(--danger)" onclick="rejectMember(${u.id}, '${esc(u.name)}', loadUsers)">Rechazar</span>
              </div>`
            : (u.role === 'client' && !u.is_leader
                ? `<span class="action-link" style="font-size:11px" onclick="makeLeader(${u.id}, loadUsers)">Hacer líder</span>` : '')}
          </div>
        </div>
      </td>
      <td><a href="mailto:${u.email}" style="color:var(--accent2)">${u.email}</a></td>
      <td>${ui.pill(u.role)}</td>
      <td>${u.org_name
            ? `${u.org_name}${u.org_status === 'prospect' ? ' <span class="pill" style="background:var(--bg3);color:var(--text2)">Nueva</span>' : ''}`
            : (u.company || '—')}</td>
      <td style="max-width:260px;font-size:12px;color:var(--text2)">${u.events
            ? u.events.split(' | ').map(t => `<div>• ${t}</div>`).join('')
            : '—'}</td>
      <td>${ui.fmtDateShort(u.created_at)}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><h2>Users</h2><p>Platform users and access roles</p></div>
      ${isAdmin() ? '<button class="btn-primary" onclick="openNewUser()"><i class="fa fa-user-plus"></i> Nuevo usuario</button>' : ''}
    </div>
    ${pending.length ? `<div class="info-msg"><i class="fa fa-user-clock"></i> Hay <b>${pending.length}</b> cuenta(s) esperando aprobación. Aparecen hasta arriba de la tabla.</div>` : ''}
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>EBC Events</th><th>Joined</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div style="margin-top:20px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      ${['admin','agent','client'].map(role => {
        const count = users.filter(u => u.role === role && u.status !== 'pending').length;
        const icons = { admin:'user-shield', agent:'headset', client:'building' };
        const colors = { admin:'purple', agent:'blue', client:'teal' };
        return `
          <div class="stat-card">
            <div class="stat-icon ${colors[role]}"><i class="fa-solid fa-${icons[role]}"></i></div>
            <div><div class="stat-value">${count}</div><div class="stat-label">${role.charAt(0).toUpperCase()+role.slice(1)}s</div></div>
          </div>`;
      }).join('')}
    </div>`;
}

function isAdmin() {
  try { return JSON.parse(localStorage.getItem('zevorus_user')).role === 'admin'; }
  catch { return false; }
}

function openNewUser() {
  ui.modal('Nuevo usuario', `
    <div class="form-row">
      <div class="form-group"><label>Nombre completo</label><input id="nu-name" placeholder="Nombre Apellido"/></div>
      <div class="form-group"><label>Email</label><input id="nu-email" type="email" placeholder="correo@empresa.mx"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Rol</label>
        <select id="nu-role">
          <option value="agent">Agent</option>
          <option value="client">Client</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="form-group"><label>Empresa</label><input id="nu-company" placeholder="Zevorus"/></div>
    </div>
    <div class="form-group"><label>Contraseña temporal</label><input id="nu-password" type="text" placeholder="8+ caracteres, mayúscula, número y símbolo"/></div>
    <div id="nu-error" class="error-msg hidden"></div>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn-secondary" onclick="ui.closeModal()">Cancelar</button>
      <button class="btn-primary" onclick="submitNewUser()">Crear</button>
    </div>`);
}

async function submitNewUser() {
  const errEl = document.getElementById('nu-error');
  try {
    await api.createUser({
      name:     document.getElementById('nu-name').value,
      email:    document.getElementById('nu-email').value,
      role:     document.getElementById('nu-role').value,
      company:  document.getElementById('nu-company').value,
      password: document.getElementById('nu-password').value,
    });
    ui.closeModal();
    ui.toast('Usuario creado');
    loadUsers();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}
