/* ================================================================
   snapshot.js — Manual Save & Restore handler
   ================================================================ */

async function getSnapshots() {
  try {
    const res = await fetch('/api/snapshots');
    if (!res.ok) throw new Error('Failed to fetch snapshots');
    const data = await res.json();
    renderSnapshots(data.snapshots || []);
  } catch (err) {
    console.error('Error loading snapshots:', err);
  }
}

function renderSnapshots(list) {
  const body = document.getElementById('snapList');
  if (!body) return;
  body.innerHTML = '';
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="3" class="muted">No snapshots yet</td></tr>';
    return;
  }
  list.forEach(snap => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${snap.name}</td>
      <td>${snap.file ? snap.file.split('/').pop() : '—'}</td>
      <td>
        <button class="btn small push" data-file="${snap.file}">Push</button>
        <button class="btn small danger del" data-id="${snap.id}">Delete</button>
      </td>
    `;
    body.appendChild(tr);
  });

  // bind push & delete
  body.querySelectorAll('.push').forEach(btn => {
    btn.addEventListener('click', async () => {
      const file = btn.dataset.file;
      if (!confirm(`Push snapshot "${file}" to system?`)) return;
      try {
        const res = await fetch('/api/snapshots/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file })
        });
        const data = await res.json();
        if (data.ok) {
          alert('Snapshot restored successfully.');
          location.reload();
        } else {
          alert('Restore failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Restore failed.');
        console.error(err);
      }
    });
  });

  body.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('Delete this snapshot?')) return;
      try {
        const res = await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          alert('Snapshot deleted.');
          getSnapshots();
        } else {
          alert('Delete failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Delete failed.');
        console.error(err);
      }
    });
  });
}

// Add snapshot
async function saveSnapshot() {
  const name = document.getElementById('snapName').value.trim();
  if (!name) return alert('Enter a name for the snapshot.');
  try {
    const res = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.ok) {
      alert('Snapshot saved successfully.');
      document.getElementById('snapName').value = '';
      getSnapshots();
    } else {
      alert('Save failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Save failed.');
    console.error(err);
  }
}

/* ================================================================
   INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('snapSave');
  if (saveBtn) saveBtn.addEventListener('click', saveSnapshot);
  getSnapshots();
});
