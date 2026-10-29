const ui = {
  toast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
  },

  modal(title, bodyHTML, wide = false) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    const box = document.getElementById('modal-box');
    box.style.maxWidth = wide ? '720px' : '580px';
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-body').innerHTML = '';
  },

  pill(val, cls) { return `<span class="pill ${cls || val}">${val.replace('_',' ')}</span>`; },

  priorityPill(p) { return ui.pill(p, p); },
  statusPill(s)   { return ui.pill(s, s); },

  fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  },

  fmtDateShort(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  },

  mitrePill(tactic) {
    if (!tactic) return '—';
    return `<span class="mitre-tag"><i class="fa-solid fa-shield-virus"></i>${tactic}</span>`;
  },

  empty(icon, msg) {
    return `<div class="empty-state"><i class="fa-solid fa-${icon}"></i><p>${msg}</p></div>`;
  },

  miniBar(label, val, max, color) {
    const pct = max > 0 ? Math.round((val / max) * 100) : 0;
    return `
      <div class="mini-bar-row">
        <div class="mini-bar-label">${label}</div>
        <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="mini-bar-val">${val}</div>
      </div>`;
  },
};

document.getElementById('modal-close').addEventListener('click', ui.closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) ui.closeModal();
});
