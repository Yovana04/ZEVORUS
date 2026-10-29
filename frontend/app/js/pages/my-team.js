// Sección "Mi equipo": solo la ve el líder de una empresa cliente.
// Aquí aprueba o rechaza a las personas que pidieron unirse a su empresa.
async function loadMyTeam() {
  const el = document.getElementById('page-my-team');
  const members = await api.team();
  const pending = members.filter(m => m.status === 'pending');
  const active  = members.filter(m => m.status === 'active');

  const pendingRows = pending.length
    ? pending.map(m => `
        <div class="participant-item">
          <div>
            <div style="font-weight:600;font-size:13px">${m.name}</div>
            <div style="color:var(--text2);font-size:12px">${m.email} · pidió acceso el ${ui.fmtDateShort(m.created_at)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-primary" onclick="approveMember(${m.id}, loadMyTeam)"><i class="fa fa-check"></i> Aprobar</button>
            <button class="btn-secondary" onclick="rejectMember(${m.id}, '${m.name.replace(/'/g, "\\'")}', loadMyTeam)">Rechazar</button>
          </div>
        </div>`).join('')
    : '<p style="color:var(--text2);font-size:13px">No hay solicitudes pendientes.</p>';

  const activeRows = active.map(m => `
    <div class="participant-item">
      <div>
        <div style="font-weight:600;font-size:13px">${m.name} ${m.is_leader ? '<span class="pill resolved">Líder</span>' : ''}</div>
        <div style="color:var(--text2);font-size:12px">${m.email}</div>
      </div>
      <div style="font-size:12px;color:var(--text2)">Desde ${ui.fmtDateShort(m.created_at)}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><h2>Mi equipo</h2><p>Como líder de tu empresa, decides quién puede entrar a la plataforma</p></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Solicitudes pendientes (${pending.length})</div>
      ${pendingRows}
    </div>
    <div class="card">
      <div class="card-title">Miembros con acceso (${active.length})</div>
      ${activeRows}
    </div>`;
}

// Compartidas con la página Users (staff).
async function approveMember(id, reload) {
  try { const r = await api.approveUser(id); ui.toast(r.message); reload(); }
  catch (err) { ui.toast(err.message, 'error'); }
}

async function rejectMember(id, name, reload) {
  if (!confirm(`¿Rechazar la solicitud de ${name}? Su cuenta se eliminará.`)) return;
  try { const r = await api.rejectUser(id); ui.toast(r.message); reload(); }
  catch (err) { ui.toast(err.message, 'error'); }
}

async function makeLeader(id, reload) {
  try { const r = await api.makeLeader(id); ui.toast(r.message); reload(); }
  catch (err) { ui.toast(err.message, 'error'); }
}
