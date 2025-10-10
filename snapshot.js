// snapshot.js
// ---------------------------------------------
// Create a point-in-time snapshot of db.json,
// store it under /data/snapshots, and register
// it in db.json → snapshots[]. Also prunes old
// snapshots to keep the folder tidy.
// ---------------------------------------------

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

// How many snapshots to keep (newest first)
const KEEP = parseInt(process.env.SNAPSHOT_KEEP || '30', 10);

// ---- helpers ----
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`db.json not found at ${DATA_FILE}. Start the server once to initialize it.`);
  }
  return fs.readJsonSync(DATA_FILE);
}
function saveDB(db) {
  fs.writeJsonSync(DATA_FILE, db, { spaces: 2 });
}
function ensureDirs() {
  fs.ensureDirSync(SNAPSHOT_DIR);
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${YYYY}-${MM}-${DD}_${hh}-${mm}-${ss}`;
}

function makeSnapshotName(prefix = 'auto') {
  return `${nowStamp()}-${prefix}.json`;
}

// ---- main ----
(async () => {
  try {
    ensureDirs();
    const db = loadDB();

    const nameFromEnv = (process.env.SNAPSHOT_NAME || '').trim(); // optional
    const snapName = makeSnapshotName(nameFromEnv || 'auto');
    const snapPath = path.join(SNAPSHOT_DIR, snapName);

    // Copy current db.json → snapshot file
    await fs.copy(DATA_FILE, snapPath);

    // Register in db.json
    const entry = {
      id: uuidv4(),
      name: nameFromEnv || `Auto ${new Date().toLocaleString()}`,
      file: snapPath,
      createdAt: new Date().toISOString(),
      kind: 'auto'
    };
    db.snapshots = Array.isArray(db.snapshots) ? db.snapshots : [];
    db.snapshots.push(entry);

    // Sort newest first
    db.snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Prune older entries beyond KEEP
    const toDelete = db.snapshots.slice(KEEP);
    for (const s of toDelete) {
      if (s.file && fs.existsSync(s.file)) {
        try { await fs.remove(s.file); } catch {}
      }
    }
    db.snapshots = db.snapshots.slice(0, KEEP);

    saveDB(db);

    console.log('✅ Snapshot created:', snapPath);
    console.log('🧹 Kept latest', KEEP, 'snapshots. Deleted', toDelete.length, 'older snapshot(s).');
    process.exit(0);
  } catch (err) {
    console.error('❌ Snapshot failed:', err.message);
    process.exit(1);
  }
})();
