/* =============================================================
   EAS Tracker – snapshot.js
   Handles: creating, listing, restoring, and deleting snapshots
   ============================================================= */

import { api, Q, fmt } from "./utils.js"; // if you split utils, else just keep in app.js

// ---- Save a new snapshot ----
async function saveSnapshot() {
  const name = prompt("Enter snapshot name (optional):", "");
  try {
    await api("/api/snapshots", { method: "POST", body: JSON.stringify({ name }) });
    alert("Snapshot saved successfully.");
    await renderSnapshots();
  } catch (err) {
    alert("Failed to save snapshot: " + err.message);
  }
}

// ---- Restore a snapshot ----
async function restoreSnapshot(file) {
  if (!confirm(`Restore snapshot "${file}"? This will overwrite current data.`)) return;
  try {
    await api("/api/snapshots/restore", { method: "POST", body: JSON.stringify({ file }) });
    alert("Snapshot restored successfully. Reloading...");
    location.reload();
  } catch (err) {
    alert("Restore failed: " + err.message);
  }
}

// ---- Delete a snapshot ----
async function deleteSnapshot(id) {
  if (!confirm("Delete this snapshot permanently?")) return;
  try {
    await api(`/api/snapshots/${id}`, { method: "DELETE" });
    await renderSnapshots();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// ---- Render snapshot list ----
export async function renderSnapshots() {
  const r = await api("/api/snapshots");
  const tb = Q("#snapList");
  if (!tb) return;

  const list = r.snapshots || [];
  tb.innerHTML = list.map(s => `
    <tr>
      <td>${s.name}</td>
      <td><small>${s.file}</small></td>
      <td>
        <button class="btn outline" data-restore="${s.file}">Restore</button>
        <button class="btn outline danger" data-del="${s.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="muted">No snapshots yet</td></tr>`;

  tb.onclick = e => {
    const restore = e.target.dataset.restore;
    const del = e.target.dataset.del;
    if (restore) restoreSnapshot(restore);
    if (del) deleteSnapshot(del);
  };
}

// ---- Attach to global buttons ----
Q("#snapSave")?.addEventListener("click", saveSnapshot);
document.addEventListener("DOMContentLoaded", renderSnapshots);
