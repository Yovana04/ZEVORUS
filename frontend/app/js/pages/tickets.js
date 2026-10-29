async function loadTickets(filters = {}) {
  const el = document.getElementById('page-tickets');
  const tickets = await api.tickets(filters);
  const orgs    = await api.orgs();
  const users   = await api.users();

  const rows = tickets.length ? tickets.map(t => `
    <tr>
      <td><span class="action-link" onclick="showTicket(${t.id})">#${t.id}</span></td>
      <td><span class="action-link" onclick="showTicket(${t.id})">${t.title}</span></td>
      <td>${ui.priorityPill(t.priority)}</td>
      <td>${ui.statusPill(t.status)}</td>
      <td>${t.category}</td>
      <td>${t.mitre_tactic ? ui.mitrePill(t.mitre_tactic) : '—'}</td>
      <td>${t.org_name || '—'}</td>
      <td>${t.assigned_name || '<span style="color:var(--text2)">Unassigned</span>'}</td>
      <td>${ui.fmtDateShort(t.created_at)}</td>
    </tr>`).join('')
    : `<tr><td colspan="9">${ui.empty('ticket','No tickets found')}</td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div><h2>Help Desk</h2><p>Manage and track all support tickets</p></div>
      <button class="btn-primary" onclick="openNewTicket()"><i class="fa fa-plus"></i> New Ticket</button>
    </div>

    <div class="filters-bar">
      <input type="text" id="tk-search" placeholder="Search tickets…" oninput="applyTicketFilters()"/>
      <select id="tk-status" onchange="applyTicketFilters()">
        <option value="">All Statuses</option>
        <option value="open">Open</option>
        <option value="in_progress">In Progress</option>
        <option value="resolved">Resolved</option>
        <option value="closed">Closed</option>
      </select>
      <select id="tk-priority" onchange="applyTicketFilters()">
        <option value="">All Priorities</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Title</th><th>Priority</th><th>Status</th>
              <th>Category</th><th>MITRE Tactic</th><th>Organization</th><th>Assigned</th><th>Created</th>
            </tr>
          </thead>
          <tbody id="tickets-tbody">${rows}</tbody>
        </table>
      </div>
    </div>`;

  // Store for modals
  window._orgs  = orgs;
  window._users = users;
}

function applyTicketFilters() {
  const search   = document.getElementById('tk-search')?.value;
  const status   = document.getElementById('tk-status')?.value;
  const priority = document.getElementById('tk-priority')?.value;
  loadTickets({ search, status, priority });
}

async function showTicket(id) {
  const t = await api.ticket(id);
  const agents = (window._users || []).filter(u => u.role === 'admin' || u.role === 'agent');

  const commentsHTML = t.comments.length
    ? t.comments.map(c => `
        <div class="comment-item">
          <div class="comment-meta">${c.author} · ${ui.fmtDate(c.created_at)}</div>
          <div class="comment-text">${c.comment}</div>
        </div>`).join('')
    : '<p style="color:var(--text2);font-size:13px">No comments yet.</p>';

  const agentOptions = agents.map(u => `<option value="${u.id}" ${t.assigned_to == u.id ? 'selected' : ''}>${u.name}</option>`).join('');

  ui.modal(`Ticket #${t.id} — ${t.title}`, `
    <div class="modal-body-inner">
      <div class="ticket-detail-grid">
        <div class="detail-item"><label>Priority</label>${ui.priorityPill(t.priority)}</div>
        <div class="detail-item"><label>Status</label>${ui.statusPill(t.status)}</div>
        <div class="detail-item"><label>Category</label><span>${t.category}</span></div>
        <div class="detail-item"><label>MITRE Tactic</label>${ui.mitrePill(t.mitre_tactic)}</div>
        <div class="detail-item"><label>Organization</label><span>${t.org_name || '—'}</span></div>
        <div class="detail-item"><label>Created</label><span>${ui.fmtDate(t.created_at)}</span></div>
        <div class="detail-item" style="grid-column:1/-1"><label>Description</label><span>${t.description}</span></div>
      </div>

      <div class="form-row" style="margin-bottom:16px">
        <div class="form-group">
          <label>Update Status</label>
          <select id="tk-upd-status">
            ${['open','in_progress','resolved','closed'].map(s => `<option ${t.status===s?'selected':''} value="${s}">${s.replace('_',' ')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Assign To</label>
          <select id="tk-upd-agent"><option value="">Unassigned</option>${agentOptions}</select>
        </div>
      </div>
      <button class="btn-primary" style="margin-bottom:20px" onclick="updateTicket(${t.id})">Save Changes</button>

      <div class="comments-section">
        <div class="card-title">Activity / Comments</div>
        <div id="tk-comments">${commentsHTML}</div>
        <div class="form-group" style="margin-top:12px">
          <textarea id="tk-comment-input" placeholder="Add a comment…" rows="3"></textarea>
        </div>
        <button class="btn-secondary" onclick="addComment(${t.id})">Add Comment</button>
      </div>
    </div>`, true);
}

async function updateTicket(id) {
  const status     = document.getElementById('tk-upd-status').value;
  const assigned_to = document.getElementById('tk-upd-agent').value || null;
  await api.updateTicket(id, { status, assigned_to });
  ui.toast('Ticket updated successfully');
  ui.closeModal();
  loadTickets();
}

async function addComment(id) {
  const comment = document.getElementById('tk-comment-input').value.trim();
  if (!comment) return ui.toast('Comment cannot be empty', 'error');
  await api.addComment(id, comment);
  ui.toast('Comment added');
  showTicket(id);
}

function openNewTicket() {
  const orgs  = window._orgs  || [];
  const users = window._users || [];
  const agents = users.filter(u => u.role !== 'client');

  const mitreTactics = ['Initial Access','Execution','Persistence','Privilege Escalation',
    'Defense Evasion','Credential Access','Discovery','Lateral Movement',
    'Collection','Command & Control','Exfiltration','Impact'];

  ui.modal('New Ticket', `
    <div class="modal-body-inner">
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="nk-title" placeholder="Brief description of the issue"/>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="nk-desc" placeholder="Detailed description…"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Priority</label>
          <select id="nk-priority">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div class="form-group">
          <label>Category</label>
          <select id="nk-category">
            <option>Incident</option>
            <option>Service Request</option>
            <option>Change Request</option>
            <option>Problem</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>MITRE ATT&CK Tactic</label>
          <select id="nk-mitre">
            <option value="">— None —</option>
            ${mitreTactics.map(t => `<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Organization</label>
          <select id="nk-org">
            <option value="">— None —</option>
            ${orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Assign To</label>
        <select id="nk-agent">
          <option value="">Unassigned</option>
          ${agents.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
        </select>
      </div>
      <div class="modal-footer" style="padding:0;margin-top:8px">
        <button class="btn-secondary" onclick="ui.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitNewTicket()">Create Ticket</button>
      </div>
    </div>`);
}

async function submitNewTicket() {
  const data = {
    title:       document.getElementById('nk-title').value.trim(),
    description: document.getElementById('nk-desc').value.trim(),
    priority:    document.getElementById('nk-priority').value,
    category:    document.getElementById('nk-category').value,
    mitre_tactic:document.getElementById('nk-mitre').value || null,
    org_id:      document.getElementById('nk-org').value || null,
    assigned_to: document.getElementById('nk-agent').value || null,
  };
  if (!data.title || !data.description) return ui.toast('Title and description required', 'error');
  await api.createTicket(data);
  ui.toast('Ticket created successfully');
  ui.closeModal();
  loadTickets();
}
