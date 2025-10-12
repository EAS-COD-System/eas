// public/snapshot.js
// Handles saving, restoring, and deleting system snapshots
async function refreshSnapshots() {
  const res = await fetch("/api/snapshots");
  const data = await res.json();
  const list = Q("#snapList");
  list.innerHTML = "";
  (data.snapshots || []).forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.name}</td>
      <td class="muted small">${s.file.split("/").pop()}</td>
      <td>
        <button class="btn small outline" data-file="${s.file}" data-action="push">Push</button>
        <button class="btn small danger outline" data-id="${s.id}" data-action="delete">Delete</button>
      </td>
    `;
    list.appendChild(tr);
  });
  list.querySelectorAll("button").forEach(btn =>
    btn.addEventListener("click", async e => {
      const act = btn.dataset.action;
      if (act === "push") {
        const file = btn.dataset.file;
        const resp = await fetch("/api/snapshots/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file })
        });
        if (resp.ok) alert("Snapshot restored successfully");
        else alert("Failed to restore snapshot");
      } else if (act === "delete") {
        const id = btn.dataset.id;
        if (!confirm("Delete this snapshot?")) return;
        await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
        refreshSnapshots();
      }
    })
  );
}

Q("#snapSave")?.addEventListener("click", async () => {
  const name = Q("#snapName").value.trim();
  if (!name) return alert("Please enter a snapshot name");
  const resp = await fetch("/api/snapshots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (resp.ok) {
    Q("#snapName").value = "";
    refreshSnapshots();
  } else {
    alert("Snapshot save failed");
  }
});

refreshSnapshots();
