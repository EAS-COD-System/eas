// snapshot.js
// Manual save and restore handler for EAS Tracker

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Root directories
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

// Initialize snapshot directory if missing
function ensureSnapshotDir() {
  fs.ensureDirSync(SNAPSHOT_DIR);
}

// Create a new snapshot
async function createSnapshot(name = '') {
  ensureSnapshotDir();
  if (!fs.existsSync(DATA_FILE)) {
    console.error('❌ db.json not found — cannot snapshot.');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = name.trim().replace(/\s+/g, '_') || 'ManualSave';
  const filename = `${stamp}-${safeName}.json`;
  const snapshotPath = path.join(SNAPSHOT_DIR, filename);

  try {
    await fs.copy(DATA_FILE, snapshotPath);
    const db = await fs.readJson(DATA_FILE);

    const entry = {
      id: uuidv4(),
      name: name || `Manual ${new Date().toLocaleString()}`,
      file: snapshotPath,
      createdAt: new Date().toISOString(),
      kind: 'manual'
    };

    db.snapshots = db.snapshots || [];
    db.snapshots.push(entry);
    db.snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    await fs.writeJson(DATA_FILE, db, { spaces: 2 });

    console.log(`✅ Snapshot saved as ${filename}`);
  } catch (err) {
    console.error('❌ Failed to create snapshot:', err);
  }
}

// Restore a snapshot
async function restoreSnapshot(snapshotFile) {
  ensureSnapshotDir();

  if (!snapshotFile) {
    console.error('❌ Please provide a snapshot filename to restore.');
    process.exit(1);
  }

  const safe = path.join(SNAPSHOT_DIR, path.basename(snapshotFile));
  if (!fs.existsSync(safe)) {
    console.error('❌ Snapshot file not found:', safe);
    process.exit(1);
  }

  try {
    await fs.copy(safe, DATA_FILE);
    console.log(`✅ Database restored from snapshot: ${snapshotFile}`);
  } catch (err) {
    console.error('❌ Failed to restore snapshot:', err);
  }
}

// CLI arguments support
const [,, command, arg] = process.argv;

(async () => {
  switch (command) {
    case 'create':
      await createSnapshot(arg || '');
      break;
    case 'restore':
      await restoreSnapshot(arg);
      break;
    default:
      console.log('\nEAS Snapshot Tool');
      console.log('===================');
      console.log('Usage:');
      console.log('  node snapshot.js create [name]   → Create a new snapshot');
      console.log('  node snapshot.js restore [file]  → Restore a snapshot file\n');
      break;
  }
})();
