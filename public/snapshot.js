// snapshot.js
// Handles manual save & restore in Settings page

async function loadSnapshots() {
  const res = await fetch('/api/snapshots');
  const data = await res.json();
  const body = document.getElementById('snapBody');
  if (!body) return;
  body.innerHTML = '';

  (data.snapshots || []).forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.name}</td>
      <td>${new Date(s.createdAt).toLocaleString()}</td>
      <td>${s.kind || 'manual'}</td>
      <td>
        <button class="btn small" onclick="restoreSnapshot('${s.file}')">Push</button>
        <button class="btn small outline red" onclick="deleteSnapshot('${s.id}')">Delete</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

async function createSnapshot() {
  const nameInput = document.getElementById('snapName');
  const name = (nameInput?.value || '').trim();
  if (!name) return alert('Enter a name for the save.');
  const res = await fetch('/api/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (data.ok) {
    alert('✅ Snapshot saved successfully.');
    nameInput.value = '';
    await loadSnapshots();
  } else {
    alert('❌ Error saving snapshot.');
  }
}

async function restoreSnapshot(file) {
  if (!confirm('Push this save into the current system?')) return;
  const res = await fetch('/api/snapshots/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file })
  });
  const data = await res.json();
  if (data.ok) {
    alert('✅ System successfully restored from snapshot.');
    await loadSnapshots();
  } else {
    alert('❌ Error restoring snapshot.');
  }
}

async function deleteSnapshot(id) {
  if (!confirm('Delete this save permanently?')) return;
  const res = await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    alert('🗑️ Snapshot deleted.');
    await loadSnapshots();
  } else {
    alert('❌ Error deleting snapshot.');
  }
}

// auto-load when Settings tab is active
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('snapBody')) loadSnapshots();
});
