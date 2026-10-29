async function loadDashboard() {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = `<div style="color:var(--text2);padding:40px;text-align:center"><i class="fa fa-spinner fa-spin"></i> Loading…</div>`;

  const s = await api.stats();

  document.getElementById('badge-open').textContent = s.openTickets;

  const pColors = { critical: '#f85149', high: '#f0883e', medium: '#f0d240', low: '#3fb950' };

  const cColors = ['#00d4aa','#0ea5e9','#a371f7','#f0883e','#f85149'];

  const maxP = Math.max(...s.byPriority.map(x => x.count), 1);
  const maxC = Math.max(...s.byCategory.map(x => x.count), 1);

  const priorityBars = s.byPriority.map(x => ui.miniBar(x.priority, x.count, maxP, pColors[x.priority] || '#00d4aa')).join('');
  const categoryBars = s.byCategory.map((x, i) => ui.miniBar(x.category, x.count, maxC, cColors[i % cColors.length])).join('');

  const mitreBars = s.mitreStats.length
    ? s.mitreStats.map((x, i) => ui.miniBar(x.mitre_tactic, x.count, s.mitreStats[0].count, '#a371f7')).join('')
    : ui.empty('shield-halved', 'No MITRE data yet');

  const recentRows = s.recentTickets.map(t => `
    <tr>
      <td><span class="action-link" onclick="showTicket(${t.id})">#${t.id} ${t.title}</span></td>
      <td>${ui.priorityPill(t.priority)}</td>
      <td>${ui.statusPill(t.status)}</td>
      <td>${t.org_name || '—'}</td>
      <td>${ui.fmtDateShort(t.created_at)}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><h2>Dashboard</h2><p>Zevorus SecOps Platform — operational overview</p></div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon teal"><i class="fa-solid fa-ticket"></i></div>
        <div><div class="stat-value">${s.totalTickets}</div><div class="stat-label">Total Tickets</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fa-solid fa-circle-dot"></i></div>
        <div><div class="stat-value">${s.openTickets}</div><div class="stat-label">Open Tickets</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div><div class="stat-value">${s.critical}</div><div class="stat-label">Critical Active</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fa-solid fa-circle-check"></i></div>
        <div><div class="stat-value">${s.resolved}</div><div class="stat-label">Resolved</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange"><i class="fa-solid fa-arrows-spin"></i></div>
        <div><div class="stat-value">${s.inProgress}</div><div class="stat-label">In Progress</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple"><i class="fa-solid fa-building"></i></div>
        <div><div class="stat-value">${s.totalOrgs}</div><div class="stat-label">Organizations</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon teal"><i class="fa-solid fa-calendar-check"></i></div>
        <div><div class="stat-value">${s.upcomingEvents}</div><div class="stat-label">Upcoming EBCs</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fa-solid fa-users"></i></div>
        <div><div class="stat-value">${s.totalParticipants}</div><div class="stat-label">EBC Participants</div></div>
      </div>
    </div>

    <div class="dash-grid thirds">
      <div class="card">
        <div class="card-title">Tickets by Priority</div>
        ${priorityBars || ui.empty('ticket','No data')}
      </div>
      <div class="card">
        <div class="card-title">Tickets by Category</div>
        ${categoryBars || ui.empty('ticket','No data')}
      </div>
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-shield-virus" style="color:var(--purple);margin-right:5px"></i>MITRE ATT&CK Tactics</div>
        ${mitreBars}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Recent Tickets</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Priority</th><th>Status</th><th>Organization</th><th>Created</th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table>
      </div>
    </div>
  `;
}
