// snapshot.js
// EAS Tracker — Automatic snapshot backup every 10 minutes

import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'db.json');
const SNAP_DIR  = path.join(__dirname, 'data', 'snapshots');

// Ensure directories exist
await fse.ensureFile(DATA_FILE);
await fse.ensureDir(SNAP_DIR);

async function createSnapshot() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destFile = path.join(SNAP_DIR, `snapshot_${timestamp}.json`);

  try {
    const exists = await fse.pathExists(DATA_FILE);
    if (!exists) {
      console.log('⚠️  No db.json found — skipping snapshot.');
      return;
    }

    await fse.copy(DATA_FILE, destFile);
    console.log(`✅ Snapshot created: ${destFile}`);

    // Limit number of stored snapshots
    const files = (await fse.readdir(SNAP_DIR))
      .filter(f => f.startsWith('snapshot_'))
      .sort()
      .reverse();

    if (files.length > 50) {
      const old = files.slice(50);
      for (const f of old) {
        await fse.remove(path.join(SNAP_DIR, f));
      }
      console.log(`🧹 Cleaned ${old.length} old snapshots`);
    }

  } catch (err) {
    console.error('❌ Snapshot creation failed:', err);
  }
}

// Run immediately and then every 10 minutes
await createSnapshot();
setInterval(createSnapshot, 10 * 60 * 1000);

console.log('📦 EAS Tracker snapshot service running (every 10 minutes)...');
