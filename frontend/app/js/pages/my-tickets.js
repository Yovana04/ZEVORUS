async function loadMyTickets() {
  const el = document.getElementById('page-my-tickets');
  const tickets = await api.tickets();

  const rows = tickets.length ? tickets.map(t => `
    <tr>
      <td><span class="action-link" onclick="showMyTicket(${t.id})">#${t.id}</span></td>
      <td><span class="action-link" onclick="showMyTicket(${t.id})">${t.title}</span></td>
      <td>${ui.priorityPill(t.priority)}</td>
      <td>${ui.statusPill(t.status)}</td>
      <td>${t.category}</td>
      <td>${ui.fmtDateShort(t.created_at)}</td>
    </tr>`).join('')
    : `<tr><td colspan="6">${ui.empty('ticket','Aún no tienes solicitudes de soporte')}</td></tr>`;

  const openCount = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  el.innerHTML = `
    <div class="page-header">
      <div><h2>Mis Tickets</h2><p>Solicitudes de soporte de ${tickets[0]?.org_name || 'tu organización'}</p></div>
      <button class="btn-primary" onclick="openMyNewTicket()"><i class="fa fa-plus"></i> Nueva Solicitud</button>
    </div>

    <div class="card" style="margin-bottom:16px;padding:14px 18px;display:flex;gap:24px">
      <div><span style="color:var(--text2);font-size:12px">ABIERTOS</span><br/><b style="font-size:20px">${openCount}</b></div>
      <div><span style="color:var(--text2);font-size:12px">TOTAL</span><br/><b style="font-size:20px">${tickets.length}</b></div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Título</th><th>Prioridad</th><th>Estatus</th><th>Categoría</th><th>Creado</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function showMyTicket(id) {
  const t = await api.ticket(id);

  const commentsHTML = t.comments.length
    ? t.comments.map(c => `
        <div class="comment-item">
          <div class="comment-meta">${c.author} · ${ui.fmtDate(c.created_at)}</div>
          <div class="comment-text">${c.comment}</div>
        </div>`).join('')
    : '<p style="color:var(--text2);font-size:13px">Sin comentarios todavía.</p>';

  ui.modal(`Ticket #${t.id} — ${t.title}`, `
    <div class="modal-body-inner">
      <div class="ticket-detail-grid">
        <div class="detail-item"><label>Prioridad</label>${ui.priorityPill(t.priority)}</div>
        <div class="detail-item"><label>Estatus</label>${ui.statusPill(t.status)}</div>
        <div class="detail-item"><label>Categoría</label><span>${t.category}</span></div>
        <div class="detail-item"><label>Creado</label><span>${ui.fmtDate(t.created_at)}</span></div>
        <div class="detail-item" style="grid-column:1/-1"><label>Descripción</label><span>${t.description}</span></div>
      </div>

      <div class="comments-section">
        <div class="card-title">Actividad / Comentarios</div>
        <div id="tk-comments">${commentsHTML}</div>
        <div class="form-group" style="margin-top:12px">
          <textarea id="tk-comment-input" placeholder="Agrega más información para el equipo de soporte…" rows="3"></textarea>
        </div>
        <button class="btn-secondary" onclick="addMyComment(${t.id})">Agregar Comentario</button>
      </div>
    </div>`, true);
}

async function addMyComment(id) {
  const comment = document.getElementById('tk-comment-input').value.trim();
  if (!comment) return ui.toast('Escribe un comentario', 'error');
  await api.addComment(id, comment);
  ui.toast('Comentario agregado');
  showMyTicket(id);
}

function openMyNewTicket() {
  ui.modal('Nueva Solicitud de Soporte', `
    <div class="modal-body-inner">
      <div class="form-group">
        <label>Título</label>
        <input type="text" id="nk-title" placeholder="Describe brevemente el problema"/>
      </div>
      <div class="form-group">
        <label>Descripción</label>
        <textarea id="nk-desc" placeholder="Detalla qué sistema está afectado, desde cuándo, y cualquier mensaje de error que hayas visto…"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Prioridad</label>
          <select id="nk-priority">
            <option value="low">Baja</option>
            <option value="medium" selected>Media</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </select>
        </div>
        <div class="form-group">
          <label>Categoría</label>
          <select id="nk-category">
            <option>Incident</option>
            <option>Service Request</option>
            <option>Change Request</option>
            <option>Problem</option>
          </select>
        </div>
      </div>
      <div class="modal-footer" style="padding:0;margin-top:8px">
        <button class="btn-secondary" onclick="ui.closeModal()">Cancelar</button>
        <button class="btn-primary" onclick="submitMyNewTicket()">Enviar Solicitud</button>
      </div>
    </div>`);
}

async function submitMyNewTicket() {
  const data = {
    title:       document.getElementById('nk-title').value.trim(),
    description: document.getElementById('nk-desc').value.trim(),
    priority:    document.getElementById('nk-priority').value,
    category:    document.getElementById('nk-category').value,
  };
  if (!data.title || !data.description) return ui.toast('Título y descripción son obligatorios', 'error');
  await api.createTicket(data);
  ui.toast('Solicitud enviada — nuestro equipo la revisará pronto');
  ui.closeModal();
  loadMyTickets();
}
