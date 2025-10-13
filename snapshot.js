// Simple CLI snapshot tool (optional)
const fs = require('fs-extra');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

(async () => {
  await fs.ensureDir(SNAPSHOT_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(SNAPSHOT_DIR, `${stamp}-manual.json`);
  await fs.copy(DATA_FILE, out);
  console.log('Snapshot created:', out);
})();
