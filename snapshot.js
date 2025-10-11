// snapshot.js
// Utility module to manage manual snapshots of db.json for EAS Tracker

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

// Ensure directory exists
function ensureSnapshotDir() {
  fs.ensureDirSync(SNAPSHOT_DIR);
}

// Create a new manual snapshot
async function createSnapshot(name = '') {
  ensureSnapshotDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = name.trim() || `Manual_${stamp}`;
  const file = path.join(SNAPSHOT_DIR, `${stamp}-${safeName.replace(/\s+/g, '_')}.json`);
  await fs.copy(DATA_FILE, file);

  return {
    id: uuidv4(),
    name: safeName,
    file,
    createdAt: new Date().toISOString(),
    kind: 'manual'
  };
}

// Restore snapshot
async function restoreSnapshot(file) {
  ensureSnapshotDir();
  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safe)) throw new Error('Snapshot not found');
  await fs.copy(safe, DATA_FILE);
  return { ok: true, restoredFrom: safe };
}

// Delete snapshot
async function deleteSnapshot(file) {
  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (fs.existsSync(safe)) await fs.remove(safe);
  return { ok: true };
}

// List all snapshots
function listSnapshots() {
  ensureSnapshotDir();
  const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => ({
    name: f,
    path: path.join(SNAPSHOT_DIR, f),
    createdAt: fs.statSync(path.join(SNAPSHOT_DIR, f)).mtime
  }));
}

module.exports = {
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  listSnapshots
};
