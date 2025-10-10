// scripts/snapshot.js
// Creates a timestamped backup of the JSON DB.
// - DATA_DIR can be overridden via env (defaults to ../data from this file)
// - Snapshot goes to <DATA_DIR>/snapshots/db-YYYYMMDD-HHmmss.json
// - Also writes <DATA_DIR>/snapshots/latest.json
// - Prunes old snapshots: keep newest 90 and anything < 120 days old

import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Resolve data dir
const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', 'data');
const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const DB_FILE    = path.join(DATA_DIR, 'db.json');
const SNAP_DIR   = path.join(DATA_DIR, 'snapshots');

// retention
const KEEP_COUNT = 90;           // keep latest N snapshots regardless of age
const KEEP_DAYS  = 120;          // also keep anything newer than this many days

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm   = pad(d.getMonth() + 1);
  const dd   = pad(d.getDate());
  const hh   = pad(d.getHours());
  const mi   = pad(d.getMinutes());
  const ss   = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function snapshot() {
  try {
    await fse.ensureDir(DATA_DIR);
    await fse.ensureDir(SNAP_DIR);

    if (!(await fse.pathExists(DB_FILE))) {
      console.error(`[snapshot] db.json not found at ${DB_FILE}. Aborting.`);
      process.exitCode = 1;
      return;
    }

    // Read DB to validate JSON
    const db = await fse.readJson(DB_FILE);
    if (!db || typeof db !== 'object') {
      console.error('[snapshot] db.json is not valid JSON object. Aborting.');
      process.exitCode = 1;
      return;
    }

    const filename = `db-${ts()}.json`;
    const dest     = path.join(SNAP_DIR, filename);

    // Write the timestamped snapshot
    await fse.writeJson(dest, db, { spaces: 2 });
    console.log(`[snapshot] Wrote ${dest}`);

    // Also write/update latest.json for quick restore/testing
    const latest = path.join(SNAP_DIR, 'latest.json');
    await fse.writeJson(latest, db, { spaces: 2 });
    console.log(`[snapshot] Updated ${latest}`);

    // Retention: keep newest 90 and anything <= 120 days old
    await prune();

  } catch (err) {
    console.error('[snapshot] Error:', err?.message || err);
    process.exitCode = 1;
  }
}

async function prune() {
  try {
    const files = (await fse.readdir(SNAP_DIR))
      .filter(f => f.endsWith('.json') && f !== 'latest.json')
      .map(f => path.join(SNAP_DIR, f));

    if (!files.length) {
      console.log('[snapshot] No snapshots to prune.');
      return;
    }

    // Sort by mtime desc (newest first)
    const stats = await Promise.all(files.map(async fp => {
      const st = await fse.stat(fp);
      return { fp, mtime: st.mtimeMs };
    }));
    stats.sort((a,b) => b.mtime - a.mtime);

    const now = Date.now();
    const maxAgeMs = KEEP_DAYS * 24 * 60 * 60 * 1000;

    const toKeep = new Set();

    // Keep latest KEEP_COUNT
    stats.slice(0, KEEP_COUNT).forEach(s => toKeep.add(s.fp));

    // Keep anything newer than KEEP_DAYS
    for (const s of stats) {
      if (now - s.mtime <= maxAgeMs) toKeep.add(s.fp);
    }

    // Delete the rest
    const deletions = stats.filter(s => !toKeep.has(s.fp));
    for (const d of deletions) {
      await fse.remove(d.fp);
      console.log(`[snapshot] Pruned ${d.fp}`);
    }

    console.log(`[snapshot] Kept ${toKeep.size} snapshot(s); pruned ${deletions.length}.`);
  } catch (err) {
    console.error('[snapshot] Prune error:', err?.message || err);
  }
}

await snapshot();
