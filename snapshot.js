// snapshot.js
// Automatic daily backup of db.json into /data/snapshots

const fs = require("fs-extra");
const path = require("path");

const DATA_FILE = path.join(__dirname, "db.json");
const SNAPSHOT_DIR = path.join(__dirname, "data", "snapshots");

async function createDailySnapshot() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.error("❌ db.json not found. Snapshot aborted.");
      return;
    }

    // Create snapshot directory if not exists
    await fs.ensureDir(SNAPSHOT_DIR);

    // Generate snapshot name
    const date = new Date().toISOString().split("T")[0]; // e.g., 2025-10-10
    const fileName = `${date}-auto.json`;
    const targetPath = path.join(SNAPSHOT_DIR, fileName);

    // Copy db.json to snapshot
    await fs.copy(DATA_FILE, targetPath);
    console.log(`✅ Snapshot created: ${fileName}`);

    // Cleanup old snapshots (keep only 7 latest)
    const files = (await fs.readdir(SNAPSHOT_DIR))
      .filter(f => f.endsWith(".json"))
      .sort((a, b) => fs.statSync(path.join(SNAPSHOT_DIR, b)).mtimeMs - fs.statSync(path.join(SNAPSHOT_DIR, a)).mtimeMs);
    if (files.length > 7) {
      const old = files.slice(7);
      for (const f of old) await fs.remove(path.join(SNAPSHOT_DIR, f));
      console.log(`🧹 Removed ${old.length} old snapshot(s).`);
    }

  } catch (err) {
    console.error("❌ Snapshot creation failed:", err);
  }
}

createDailySnapshot();
