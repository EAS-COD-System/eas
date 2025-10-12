/* ================================================================
   SNAPSHOT.JS — Manual Save / Restore / Delete Handler
   Used in Settings page
   ================================================================ */

async function fetchSnapshots() {
  try {
    const res = await fetch('/api/snapshots');
    const data = await res.json();
    renderSnapshots(data.snapshots || []);
  } catch (err) {
    console.error('Error fetching snapshots:', err);
  }
}

function renderSnapshots(list) {
  const wrap = document.getElementById('ssList');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!list.length) {
    wrap.innerHTML = '<div class="muted">No snapshots saved yet.</div>';
    return;
  }

  list.forEach(s => {
    const div = document.createElement('div');
    div.className = 'snapshot-row';
    div.innerHTML = `
      <div class="snap-info">
        <div><b>${s.name}</b></div>
        <div class="small">${new Date(s.createdAt).toLocaleString()}</div>
      </div>
      <div class="snap-actions">
        <button class="btn small outline" data-file="${s.file}" data-id="${s.id}" data-action="push">Push</button>
        <button class="btn small danger outline" data-id="${s.id}" data-action="delete">Delete</button>
      </div>
    `;
    wrap.appendChild(div);
  });
}

async function saveSnapshot() {
  const name = prompt('Enter name for this save (e.g. Before Update, End of Week, etc):');
  if (!name) return;
  try {
    const res = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.ok) {
      alert('✅ Snapshot saved successfully.');
      fetchSnapshots();
    } else {
      alert('❌ Failed to save snapshot.');
    }
  } catch (err) {
    console.error(err);
    alert('Error saving snapshot.');
  }
}

async function pushSnapshot(file) {
  if (!confirm('⚠️ This will overwrite the current system data with this snapshot. Continue?')) return;
  try {
    const res = await fetch('/api/snapshots/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file })
    });
    const data = await res.json();
    if (data.ok) {
      alert('✅ Snapshot restored successfully.');
      // Keep it listed — user can delete later
      fetchSnapshots();
    } else {
      alert('❌ Failed to restore snapshot.');
    }
  } catch (err) {
    console.error(err);
    alert('Error restoring snapshot.');
  }
}

async function deleteSnapshot(id) {
  if (!confirm('Delete this snapshot?')) return;
  try {
    const res = await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      alert('🗑️ Snapshot deleted.');
      fetchSnapshots();
    } else {
      alert('❌ Failed to delete snapshot.');
    }
  } catch (err) {
    console.error(err);
    alert('Error deleting snapshot.');
  }
}

// ========================= INIT =========================
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('ssSave');
  const list = document.getElementById('ssList');
  if (saveBtn) saveBtn.addEventListener('click', saveSnapshot);
  if (list) {
    list.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.action;
      if (act === 'push') pushSnapshot(btn.dataset.file);
      if (act === 'delete') deleteSnapshot(btn.dataset.id);
    });
  }
  fetchSnapshots();
});
