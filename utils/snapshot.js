// utils/snapshot.js
// Simple file-based snapshots for db.json
// NOTE: restore does NOT delete the snapshot you restored from.

const fs = require('fs');
const path = require('path');

const SNAP_DIR = path.join(__dirname, '..', 'data', 'snapshots');

function ensureSnapshotDir() {
  if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  }
  if (!fs.existsSync(SNAP_DIR)) {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
  }
}

function safeName(s = '') {
  return String(s).trim().replace(/[^\w\s-]+/g, '').replace(/\s+/g, '-').slice(0, 80);
}

function listSnapshots() {
  ensureSnapshotDir();
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  return files.map(f => {
    const base = f.replace(/\.json$/i, '');
    // format: <iso-ts>__<name>.json
    const parts = base.split('__');
    const ts = parts[0] || '';
    const name = parts.slice(1).join('__') || base;
    return {
      id: base,
      name,
      file: path.join('data', 'snapshots', f),
      createdAt: ts
    };
  });
}

function createSnapshot(dbFilePath, name = '') {
  ensureSnapshotDir();
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = `${now}__${safeName(name) || 'snapshot'}.json`;
  const dest = path.join(SNAP_DIR, fname);
  fs.copyFileSync(dbFilePath, dest);
  return path.join('data', 'snapshots', fname); // relative path returned to client
}

function restoreSnapshot(dbFilePath, relFile) {
  ensureSnapshotDir();
  // Hardening: only allow restore from our snapshots folder
  const abs = path.resolve(path.join(__dirname, '..', relFile || ''));
  if (!abs.startsWith(SNAP_DIR)) {
    throw new Error('Invalid snapshot path');
  }
  if (!fs.existsSync(abs)) {
    throw new Error('Snapshot not found');
  }
  fs.copyFileSync(abs, dbFilePath);
  // IMPORTANT: do NOT delete the snapshot file; keep it until user deletes.
}

function deleteSnapshot(id) {
  ensureSnapshotDir();
  const file = path.join(SNAP_DIR, `${id}.json`);
  if (!file.startsWith(SNAP_DIR)) return false;
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

module.exports = {
  ensureSnapshotDir,
  listSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot
};
