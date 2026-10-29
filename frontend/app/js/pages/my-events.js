async function loadMyEvents() {
  const el = document.getElementById('page-my-events');
  const events = await api.events();

  const cards = events.length ? events.map(e => `
    <div class="card" style="margin-bottom:14px;padding:18px 20px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
        <div>
          <div style="font-weight:700;font-size:15px;margin-bottom:4px">${e.title}</div>
          <div style="color:var(--text2);font-size:13px">${ui.fmtDateShort(e.date)} · ${e.location || 'Ubicación por confirmar'}</div>
        </div>
        ${ui.statusPill(e.status)}
      </div>
      ${e.description ? `<p style="color:var(--text2);font-size:13px;margin-top:10px">${e.description}</p>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:12px;flex-wrap:wrap">
        <span style="font-size:13px;color:var(--text2)">${e.registered_count} / ${e.capacity} registrados${e.org_id ? '' : ' · Sesión abierta'}</span>
        <div style="display:flex;align-items:center;gap:14px">
          ${e.joined
            ? '<span class="pill resolved"><i class="fa fa-check"></i> Ya estás inscrito</span>'
            : (e.status === 'scheduled' && e.registered_count < e.capacity
                ? `<button class="btn-primary" onclick="joinMyEvent(${e.id})"><i class="fa fa-user-plus"></i> Inscribirme</button>`
                : '')}
          <span class="action-link" onclick="showMyEvent(${e.id})">Ver detalles →</span>
        </div>
      </div>
    </div>`).join('')
    : `<div class="card">${ui.empty('calendar-days','Por ahora no hay sesiones EBC disponibles')}</div>`;

  el.innerHTML = `
    <div class="page-header">
      <div><h2>Sesiones EBC</h2><p>Executive Immersion Experience — inscríbete a las sesiones disponibles</p></div>
    </div>
    ${cards}`;
}

async function showMyEvent(id) {
  const e = await api.event(id);
  const pRows = e.participants.length
    ? e.participants.map(p => `
        <div class="participant-item">
          <div>
            <div style="font-weight:600;font-size:13px">${p.name}</div>
            <div style="color:var(--text2);font-size:12px">${p.role || ''} — ${p.company || ''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:12px;color:var(--text2)">${p.email}</div>
            ${p.attended ? '<span class="pill resolved">Asistió</span>' : '<span class="pill" style="background:var(--bg3);color:var(--text2)">Registrado</span>'}
          </div>
        </div>`).join('')
    : '<p style="color:var(--text2);font-size:13px">Nadie de tu equipo se ha registrado todavía.</p>';

  ui.modal(e.title, `
    <div class="modal-body-inner">
      <div class="ticket-detail-grid">
        <div class="detail-item"><label>Fecha</label><span>${ui.fmtDateShort(e.date)}</span></div>
        <div class="detail-item"><label>Estatus</label>${ui.statusPill(e.status)}</div>
        <div class="detail-item"><label>Ubicación</label><span>${e.location || '—'}</span></div>
        <div class="detail-item"><label>Cupo</label><span>${e.participants.length} / ${e.capacity} registrados</span></div>
        ${e.description ? `<div class="detail-item" style="grid-column:1/-1"><label>Descripción</label><span>${e.description}</span></div>` : ''}
      </div>

      ${e.joined ? '' : (e.status === 'scheduled'
        ? `<button class="btn-primary" style="margin-bottom:16px" onclick="joinMyEvent(${e.id}, true)"><i class="fa fa-user-plus"></i> Inscribirme a esta sesión</button>`
        : '')}
      <div class="card-title">Participantes de tu equipo (${e.participants.length})</div>
      <div id="participants-list">${pRows}</div>

      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div class="card-title">Registrar a otra persona de tu empresa</div>
        <div class="form-row">
          <div class="form-group"><label>Nombre</label><input id="np-name" placeholder="Nombre completo"/></div>
          <div class="form-group"><label>Correo</label><input id="np-email" type="email" placeholder="correo@empresa.mx"/></div>
        </div>
        <div class="form-group"><label>Puesto</label><input id="np-role" placeholder="CTO, Director de TI…"/></div>
        <button class="btn-primary" onclick="registerMyParticipant(${e.id})">Registrar</button>
      </div>
    </div>`, true);
}

async function registerMyParticipant(eventId) {
  const data = {
    name:    document.getElementById('np-name').value.trim(),
    email:   document.getElementById('np-email').value.trim(),
    role:    document.getElementById('np-role').value.trim(),
  };
  if (!data.name || !data.email) return ui.toast('Nombre y correo son obligatorios', 'error');
  try {
    await api.addParticipant(eventId, data);
    ui.toast('Participante registrado');
    showMyEvent(eventId);
    loadMyEvents();
  } catch (err) { ui.toast(err.message, 'error'); }
}

async function joinMyEvent(eventId, fromModal) {
  try {
    await api.joinEvent(eventId);
    ui.toast('¡Listo! Quedaste inscrito en la sesión');
    if (fromModal) showMyEvent(eventId);
    loadMyEvents();
  } catch (err) { ui.toast(err.message, 'error'); }
}
