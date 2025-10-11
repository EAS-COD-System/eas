// snapshot.js
// Handles saving, listing, restoring, and deleting snapshots (manual system saves)

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { loadDB, saveDB, DATA_FILE } = require('./db');

const SNAPSHOT_DIR = path.join(__dirname, 'data', 'snapshots');

// Ensure the directory exists
function ensureSnapshotDir() {
  fs.ensureDirSync(SNAPSHOT_DIR);
}

// Load all snapshots from db.json
function getSnapshots() {
  const db = loadDB();
  return db.snapshots || [];
}

// Save a new snapshot (manual system backup)
async function createSnapshot(name = '') {
  ensureSnapshotDir();
  const db = loadDB();

  const snapshotName = name.trim() || `Manual ${new Date().toLocaleString()}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${timestamp}-${snapshotName.replace(/\s+/g, '_')}.json`;
  const fullPath = path.join(SNAPSHOT_DIR, fileName);

  await fs.copy(DATA_FILE, fullPath);

  const newSnapshot = {
    id: uuidv4(),
    name: snapshotName,
    file: fullPath,
    createdAt: new Date().toISOString(),
    kind: 'manual'
  };

  db.snapshots = db.snapshots || [];
  db.snapshots.push(newSnapshot);
  db.snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  saveDB(db);
  return newSnapshot;
}

// Restore a snapshot (push it to system)
async function restoreSnapshot(file) {
  ensureSnapshotDir();
  const safePath = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safePath)) throw new Error('Snapshot file not found');

  await fs.copy(safePath, DATA_FILE);
  return { ok: true, restoredFrom: safePath };
}

// Delete a snapshot (manual removal)
async function deleteSnapshot(id) {
  const db = loadDB();
  db.snapshots = (db.snapshots || []).filter(s => s.id !== id);
  saveDB(db);
  return { ok: true };
}

module.exports = {
  getSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  SNAPSHOT_DIR
};
