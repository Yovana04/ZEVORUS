async function loadOrganizations() {
  const el   = document.getElementById('page-organizations');
  const orgs = await api.orgs();

  const rows = orgs.map(o => `
    <tr>
      <td><b>${o.name}</b></td>
      <td>${o.industry || '—'}</td>
      <td>${o.contact || '—'}</td>
      <td><a href="mailto:${o.email}" style="color:var(--accent2)">${o.email || '—'}</a></td>
      <td>${o.phone || '—'}</td>
      <td>${ui.pill(o.status || 'active')}</td>
      <td><span class="pill blue" style="background:#0ea5e918;color:var(--accent2)">${o.ticket_count} tickets</span></td>
      <td><span class="action-link" onclick="editOrg(${o.id})">Edit</span></td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><h2>Organizations</h2><p>Client and prospect organizations managed by Zevorus</p></div>
      <button class="btn-primary" onclick="openNewOrg()"><i class="fa fa-plus"></i> New Organization</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Industry</th><th>Contact</th><th>Email</th><th>Phone</th><th>Status</th><th>Tickets</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  window._allOrgs = orgs;
}

function openNewOrg() {
  ui.modal('New Organization', `
    <div class="modal-body-inner">
      <div class="form-row">
        <div class="form-group"><label>Organization Name</label><input id="no-name" placeholder="Acme Corp"/></div>
        <div class="form-group"><label>Industry</label>
          <select id="no-industry">
            <option>Manufacturing</option><option>Finance</option><option>Healthcare</option>
            <option>Energy</option><option>Logistics</option><option>Retail</option><option>Technology</option><option>Government</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Primary Contact</label><input id="no-contact" placeholder="Full Name"/></div>
        <div class="form-group"><label>Email</label><input id="no-email" type="email" placeholder="contact@company.mx"/></div>
      </div>
      <div class="form-group"><label>Phone</label><input id="no-phone" placeholder="999-000-0000"/></div>
      <div class="modal-footer" style="padding:0;margin-top:8px">
        <button class="btn-secondary" onclick="ui.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitNewOrg()">Create</button>
      </div>
    </div>`);
}

async function submitNewOrg() {
  const data = {
    name:     document.getElementById('no-name').value.trim(),
    industry: document.getElementById('no-industry').value,
    contact:  document.getElementById('no-contact').value.trim(),
    email:    document.getElementById('no-email').value.trim(),
    phone:    document.getElementById('no-phone').value.trim(),
  };
  if (!data.name) return ui.toast('Name is required', 'error');
  await api.createOrg(data);
  ui.toast('Organization created');
  ui.closeModal();
  loadOrganizations();
}

async function editOrg(id) {
  const o = (window._allOrgs || []).find(x => x.id === id);
  if (!o) return;
  ui.modal(`Edit: ${o.name}`, `
    <div class="modal-body-inner">
      <div class="form-row">
        <div class="form-group"><label>Name</label><input id="eo-name" value="${o.name}"/></div>
        <div class="form-group"><label>Industry</label><input id="eo-industry" value="${o.industry || ''}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Contact</label><input id="eo-contact" value="${o.contact || ''}"/></div>
        <div class="form-group"><label>Email</label><input id="eo-email" value="${o.email || ''}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input id="eo-phone" value="${o.phone || ''}"/></div>
        <div class="form-group"><label>Status</label>
          <select id="eo-status">
            <option value="active" ${o.status==='active'?'selected':''}>Active</option>
            <option value="prospect" ${o.status==='prospect'?'selected':''}>Prospect</option>
            <option value="inactive" ${o.status==='inactive'?'selected':''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="modal-footer" style="padding:0;margin-top:8px">
        <button class="btn-secondary" onclick="ui.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="submitEditOrg(${id})">Save Changes</button>
      </div>
    </div>`);
}

async function submitEditOrg(id) {
  const data = {
    name:     document.getElementById('eo-name').value.trim(),
    industry: document.getElementById('eo-industry').value.trim(),
    contact:  document.getElementById('eo-contact').value.trim(),
    email:    document.getElementById('eo-email').value.trim(),
    phone:    document.getElementById('eo-phone').value.trim(),
    status:   document.getElementById('eo-status').value,
  };
  await api.updateOrg(id, data);
  ui.toast('Organization updated');
  ui.closeModal();
  loadOrganizations();
}
