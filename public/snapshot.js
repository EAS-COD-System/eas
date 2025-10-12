// public/snapshot.js

async function refreshSnapshots() {
  const res = await fetch('/api/snapshots');
  const snaps = await res.json();
  const tbody = document.querySelector('#snapList');
  if (!tbody) return;
  tbody.innerHTML = '';
  snaps.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.name}</td>
      <td>${s.file}</td>
      <td>
        <button class="btn outline" data-restore="${s.file}">Restore</button>
        <button class="btn danger outline" data-del="${s.file}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

document.addEventListener('click', async e => {
  const t = e.target;
  if (t.matches('#snapSave')) {
    const name = document.querySelector('#snapName')?.value.trim();
    if (!name) return alert('Enter snapshot name');
    const res = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      alert('Snapshot saved');
      refreshSnapshots();
    }
  }

  if (t.dataset.restore) {
    if (!confirm('Restore this snapshot? It will overwrite current data.')) return;
    const res = await fetch(`/api/snapshots/${t.dataset.restore}/restore`, { method: 'POST' });
    if (res.ok) {
      alert('System restored. Refreshing...');
      location.reload();
    }
  }

  if (t.dataset.del) {
    if (!confirm('Delete this snapshot?')) return;
    const res = await fetch(`/api/snapshots/${t.dataset.del}`, { method: 'DELETE' });
    if (res.ok) refreshSnapshots();
  }
});

window.addEventListener('DOMContentLoaded', refreshSnapshots);
