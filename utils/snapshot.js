/* ======================================================================
   EAS Tracker – snapshot.js
   Lightweight helper for manual save/restore snapshots.
   Works with server routes:
     GET    /api/snapshots
     POST   /api/snapshots              (body: { name })
     POST   /api/snapshots/restore      (body: { file })
     DELETE /api/snapshots/:id
   ====================================================================== */

(function () {
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error(data?.error || data || `HTTP ${res.status}`);
    return data;
  }

  const Snapshot = {
    /** Get list of snapshots. Returns Array<{id,name,file,createdAt,kind}> */
    async list() {
      const r = await api('/api/snapshots');
      return r.snapshots || [];
    },

    /** Create a new snapshot. Returns created snapshot object */
    async create(name = '') {
      const r = await api('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      return r.snapshot;
    },

    /** Restore (push) a snapshot from its file path. Returns true on success */
    async restore(file) {
      if (!file) throw new Error('Missing snapshot file path');
      await api('/api/snapshots/restore', {
        method: 'POST',
        body: JSON.stringify({ file })
      });
      return true;
    },

    /** Delete snapshot by id. Returns true on success */
    async remove(id) {
      if (!id) throw new Error('Missing snapshot id');
      await api('/api/snapshots/' + encodeURIComponent(id), { method: 'DELETE' });
      return true;
    }
  };

  // expose to window
  if (typeof window !== 'undefined') {
    window.Snapshot = Snapshot;
  }
})();
