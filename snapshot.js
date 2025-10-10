// snapshot.js
// Periodically snapshot the live database file to data/snapshots/.
// Run this as a separate "Worker" on Render so it keeps making backups.

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- Config ----------
const TZ = process.env.TZ || 'Africa/Casablanca';
process.env.TZ = TZ;

// Where the live db is stored (same location server.js uses)
const DATA_DIR    = path.join(__dirname, 'data');
const LIVE_DB     = path.join(DATA_DIR, 'db.json');
const SNAP_DIR    = path.join(DATA_DIR, 'snapshots');

// Interval & retention
const INTERVAL_MIN   = +process.env.SNAPSHOT_INTERVAL_MINUTES || 1440;   // default: 24h
const KEEP_MAX       = +process.env.SNAPSHOT_KEEP || 120;                 // keep last N snapshots (120 ~ 4 months daily)
const MIN_FILE_BYTES = 100;                                              // sanity check to avoid saving empty files

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function stamp() {
  // Human & filesystem friendly: 2025-10-10_23-40-05
  const d = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm   = pad(d.getMonth()+1);
  const dd   = pad(d.getDate());
  const hh   = pad(d.getHours());
  const mi   = pad(d.getMinutes());
  const ss   = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

async function ensurePaths() {
  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(SNAP_DIR);
  if (!(await fs.pathExists(LIVE_DB))) {
    // Create a minimal db if somehow missing (server normally seeds this)
    const minimal = {
      meta: { currency:'USD', theme:{primary:'#0E9F6E', bg:'#fff'}, createdAt: new Date().toISOString() },
      countries: ["china","kenya","tanzania","uganda","zambia","zimbabwe"],
      products: [],
      shipments: [],
      remittances: [],
      adSpends: [],
      deliveries: [],
      deliveriesWeekly: {},
      financeCategories: {debits:["Facebook Ads","TikTok Ads","Google Ads","Shipping","Salaries"], credits:["Revenue Boxleo","Other Revenue"]},
      financeEntries: [],
      influencers: [],
      influencersSpend: [],
      allowlistIPs: []
    };
    await fs.writeJson(LIVE_DB, minimal, { spaces: 2 });
  }
}

async function sizeOk(file) {
  try {
    const st = await fs.stat(file);
    return st.size >= MIN_FILE_BYTES;
  } catch {
    return false;
  }
}

async function makeSnapshot() {
  const ts = stamp();
  const targetDir = path.join(SNAP_DIR, ts);
  const targetDB  = path.join(targetDir, 'db.json');

  await fs.ensureDir(targetDir);

  // Copy db.json -> snapshots/<ts>/db.json
  if (!(await sizeOk(LIVE_DB))) {
    console.warn(`[snapshot] Live DB too small or missing, skipping snapshot @ ${ts}`);
    return null;
  }

  await fs.copy(LIVE_DB, targetDB);
  console.log(`[snapshot] Saved ${path.relative(__dirname, targetDB)}`);

  return targetDir;
}

async function pruneOld() {
  const entries = await fs.readdir(SNAP_DIR).catch(()=>[]);
  const dirs = [];
  for (const name of entries) {
    const p = path.join(SNAP_DIR, name);
    const st = await fs.stat(p).catch(()=>null);
    if (st?.isDirectory()) {
      dirs.push({ name, path: p, mtime: st.mtime });
    }
  }
  dirs.sort((a,b)=> b.mtime - a.mtime); // newest first
  if (dirs.length > KEEP_MAX) {
    const toDelete = dirs.slice(KEEP_MAX);
    for (const d of toDelete) {
      await fs.remove(d.path).catch(()=>{});
      console.log(`[snapshot] Pruned ${d.name}`);
    }
  }
}

async function loop() {
  console.log(`[snapshot] Starting; interval=${INTERVAL_MIN}m, keep=${KEEP_MAX}, TZ=${TZ}`);
  await ensurePaths();

  // Take an immediate snapshot on boot (handy after deploys)
  await makeSnapshot().catch(e=> console.error('[snapshot] initial error', e));
  await pruneOld().catch(()=>{});

  const intervalMs = Math.max(1, INTERVAL_MIN) * 60 * 1000;

  // Simple loop; Render worker stays alive and runs this forever
  // If Render restarts the worker, it will just resume.
  // No overlapping runs — this is sequential.
  for(;;){
    await sleep(intervalMs);
    try {
      await ensurePaths();
      await makeSnapshot();
      await pruneOld();
    } catch (e) {
      console.error('[snapshot] loop error', e);
    }
  }
}

// Run
loop().catch(e=>{
  console.error('[snapshot] fatal', e);
  process.exit(1);
});
