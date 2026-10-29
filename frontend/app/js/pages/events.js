async function loadEvents() {
  const el     = document.getElementById('page-events');
  const events = await api.events();
  const orgs   = await api.orgs();

  const rows = events.map(e => `
    <tr>
      <td><span class="action-link" onclick="showEvent(${e.id})">${e.title}</span></td>
      <td>${e.org_name || '—'}</td>
      <td>${ui.fmtDateShort(e.date)}</td>
      <td>${e.location || '—'}</td>
      <td>${ui.statusPill(e.status)}</td>
      <td>${e.registered_count} / ${e.capacity}</td>
      <td><span class="action-link" onclick="showEvent(${e.id})">View →</span></td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><h2>EBC Events</h2><p>Executive Immersion Experience sessions and participants</p></div>
      <button class="btn-primary" onclick="openNewEvent()"><i class="fa fa-plus"></i> New Event</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Title</th><th>Organization</th><th>Date</th><th>Location</th><th>Status</th><th>Registered</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  window._allOrgs = orgs;
}

async function showEvent(id) {
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
            ${p.attended ? '<span class="pill resolved">Attended</span>' : '<span class="pill" style="background:var(--bg3);color:var(--text2)">Registered</span>'}
          </div>
        </div>`).join('')
    : '<p style="color:var(--text2);font-size:13px">No participants registered yet.</p>';

  ui.modal(e.title, `
    <div class="modal-body-inner">
      <div class="ticket-detail-grid">
        <div class="detail-item"><label>Date</label><span>${ui.fmtDateShort(e.date)}</span></div>
        <div class="detail-item"><label>Status</label>${ui.statusPill(e.status)}</div>
        <div class="detail-item"><label>Location</label><span>${e.location || '—'}</span></div>
        <div class="detail-item"><label>Organization</label><span>${e.org_name || '—'}</span></div>
        <div class="detail-item"><label>Capacity</label><span>${e.participants.length} / ${e.capacity} registered</span></div>
        ${e.description ? `<div class="detail-item" style="grid-column:1/-1"><label>Description</label><span>${e.description}</span></div>` : ''}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:20px">
        <button class="btn-secondary" onclick="updateEventStatus(${e.id},'completed')">Mark Completed</button>
        <button class="btn-danger" onclick="updateEventStatus(${e.id},'cancelled')">Cancel Event</button>
      </div>

      <div class="card-title">Participants (${e.participants.length})</div>
      <div id="participants-list">${pRows}</div>

      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div class="card-title">Register New Participant</div>
        <div class="form-row">
          <div class="form-group"><label>Name</label><input id="np-name" placeholder="Full Name"/></div>
          <div class="form-group"><label>Email</label><input id="np-email" type="email" placeholder="email@company.mx"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Company</label><input id="np-company" placeholder="Company Name"/></div>
          <div class="form-group"><label>Role</label><input id="np-role" placeholder="CTO, IT Director…"/></div>
        </div>
        <button class="btn-primary" onclick="registerParticipant(${e.id})">Register Participant</button>
      </div>
    </div>`, true);
}

async function registerParticipant(eventId) {
  const data = {
    name:    document.getElementById('np-name').value.trim(),
    email:   document.getElementById('np-email').value.trim(),
    company: document.getElementById('np-company').value.trim(),
    role:    document.getElementById('np-role').value.trim(),
  };
  if (!data.name || !data.email) return ui.toast('Name and email are required', 'error');
  await api.addParticipant(eventId, data);
  ui.toast('Participant registered');
  showEvent(eventId);
  loadEvents();
}

async function updateEventStatus(id, status) {
  await api.updateEvent(id, { status });
  ui.toast(`Event marked as ${status}`);
  ui.closeModal();
  loadEvents();
}

function openNewEvent() {
  const orgs = window._allOrgs || [];
  ui.modal('New EBC Event', `
    <div class="modal-body-inner">
      <div class="form-group"><label>Event Title</label><input id="ne-title" placeholder="Google SecOps Live Demo – Company Name"/></div>
      <div class="form-group"><label>Description</label><textarea id="ne-desc" placeholder="Session overview and objectives…"></textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="ne-date"/></div>
        <div class="form-group"><label>Location</label><input id="ne-location" placeholder="TecniA Park, Sala A3 / Virtual"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Organization</label>
          <select id="ne-org">
            <option value="">— None —</option>
            ${orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Capacity</label><input type="number" id="ne-capacity" value="20" min="1"/></div>
      </div>
      <div class="modal-footer" style="padding:0;margin-top:8px">
        <button class="btn-secondary" onclick="ui.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitNewEvent()">Create Event</button>
      </div>
    </div>`);
}

async function submitNewEvent() {
  const data = {
    title:       document.getElementById('ne-title').value.trim(),
    description: document.getElementById('ne-desc').value.trim(),
    date:        document.getElementById('ne-date').value,
    location:    document.getElementById('ne-location').value.trim(),
    org_id:      document.getElementById('ne-org').value || null,
    capacity:    parseInt(document.getElementById('ne-capacity').value) || 20,
  };
  if (!data.title || !data.date) return ui.toast('Title and date are required', 'error');
  await api.createEvent(data);
  ui.toast('Event created successfully');
  ui.closeModal();
  loadEvents();
}
