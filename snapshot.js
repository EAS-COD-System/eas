// ======================================================================
// snapshot.js
// Handles manual save and restore of db.json snapshots
// Integrated with server.js for EAS Tracker system
// ======================================================================

import fs from "fs-extra";
import path from "path";

const DB_PATH = path.resolve("db.json");
const SNAP_DIR = path.resolve("snapshots");

// Ensure snapshot directory exists
if (!fs.existsSync(SNAP_DIR)) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
}

// ----------------------------------------------------------------------
// Create a new snapshot
// ----------------------------------------------------------------------
export async function createSnapshot(name = "") {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = name ? name.replace(/[^\w\s-]/g, "_") : "manual";
    const fileName = `${timestamp}_${safeName}.json`;
    const dest = path.join(SNAP_DIR, fileName);

    await fs.copy(DB_PATH, dest);
    console.log(`✅ Snapshot saved: ${fileName}`);
    return { success: true, file: fileName };
  } catch (err) {
    console.error("❌ Snapshot save failed:", err);
    return { success: false, error: err.message };
  }
}

// ----------------------------------------------------------------------
// List all snapshots
// ----------------------------------------------------------------------
export async function listSnapshots() {
  try {
    const files = await fs.readdir(SNAP_DIR);
    const list = files
      .filter(f => f.endsWith(".json"))
      .map((f, i) => ({
        id: i + 1,
        name: f.replace(".json", ""),
        file: f
      }))
      .sort((a, b) => (a.file < b.file ? 1 : -1));

    return { success: true, snapshots: list };
  } catch (err) {
    console.error("❌ Snapshot list failed:", err);
    return { success: false, error: err.message, snapshots: [] };
  }
}

// ----------------------------------------------------------------------
// Restore from snapshot
// ----------------------------------------------------------------------
export async function restoreSnapshot(file) {
  try {
    const src = path.join(SNAP_DIR, file);
    if (!fs.existsSync(src)) throw new Error("Snapshot not found");
    await fs.copy(src, DB_PATH);
    console.log(`♻️  Snapshot restored from ${file}`);
    return { success: true };
  } catch (err) {
    console.error("❌ Snapshot restore failed:", err);
    return { success: false, error: err.message };
  }
}

// ----------------------------------------------------------------------
// Delete a snapshot manually
// ----------------------------------------------------------------------
export async function deleteSnapshot(idOrFile) {
  try {
    const files = await fs.readdir(SNAP_DIR);
    const match = files.find(
      f =>
        f === idOrFile ||
        f.includes(idOrFile) ||
        f.replace(".json", "") === idOrFile
    );
    if (!match) throw new Error("Snapshot not found");

    const target = path.join(SNAP_DIR, match);
    await fs.remove(target);
    console.log(`🗑️ Snapshot deleted: ${match}`);
    return { success: true };
  } catch (err) {
    console.error("❌ Snapshot delete failed:", err);
    return { success: false, error: err.message };
  }
}
