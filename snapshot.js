const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ROOT = path.dirname(__dirname);
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

async function createSnapshot(name = '') {
  try {
    await fs.ensureDir(SNAPSHOT_DIR);
    
    const db = await fs.readJson(DATA_FILE);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotName = name || `Manual-${timestamp}`;
    const snapshotFile = path.join(SNAPSHOT_DIR, `${timestamp}-${snapshotName.replace(/\s+/g, '_')}.json`);
    
    await fs.copy(DATA_FILE, snapshotFile);
    
    const snapshot = {
      id: uuidv4(),
      name: snapshotName,
      file: snapshotFile,
      createdAt: new Date().toISOString(),
      kind: 'manual'
    };
    
    db.snapshots = db.snapshots || [];
    db.snapshots.unshift(snapshot);
    await fs.writeJson(DATA_FILE, db, { spaces: 2 });
    
    console.log('✅ Snapshot created:', snapshotFile);
    return snapshot;
  } catch (error) {
    console.error('❌ Snapshot error:', error.message);
    throw error;
  }
}

async function listSnapshots() {
  try {
    const db = await fs.readJson(DATA_FILE);
    const snapshots = db.snapshots || [];
    
    console.log('\n📸 Snapshots:');
    console.log('=' .repeat(50));
    
    snapshots.forEach((snap, i) => {
      console.log(`${i + 1}. ${snap.name}`);
      console.log(`   File: ${path.basename(snap.file)}`);
      console.log(`   Date: ${new Date(snap.createdAt).toLocaleString()}`);
      console.log(`   ID: ${snap.id}\n`);
    });
    
    return snapshots;
  } catch (error) {
    console.error('❌ List error:', error.message);
    throw error;
  }
}

async function restoreSnapshot(snapshotId) {
  try {
    const db = await fs.readJson(DATA_FILE);
    const snapshot = (db.snapshots || []).find(s => s.id === snapshotId);
    
    if (!snapshot) {
      throw new Error('Snapshot not found: ' + snapshotId);
    }
    
    if (!await fs.pathExists(snapshot.file)) {
      throw new Error('Snapshot file missing: ' + snapshot.file);
    }
    
    // Create backup before restore
    const backupFile = path.join(SNAPSHOT_DIR, `pre-restore-${Date.now()}.json`);
    await fs.copy(DATA_FILE, backupFile);
    
    await fs.copy(snapshot.file, DATA_FILE);
    
    console.log('✅ Database restored from:', path.basename(snapshot.file));
    console.log('💾 Backup saved as:', path.basename(backupFile));
    
    return { restored: snapshot, backup: backupFile };
  } catch (error) {
    console.error('❌ Restore error:', error.message);
    throw error;
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'create':
    case 'c':
      const name = process.argv.slice(3).join(' ') || '';
      await createSnapshot(name);
      break;
      
    case 'list':
    case 'ls':
      await listSnapshots();
      break;
      
    case 'restore':
    case 'r':
      const snapshotId = process.argv[3];
      if (!snapshotId) {
        console.error('❌ Provide snapshot ID');
        process.exit(1);
      }
      await restoreSnapshot(snapshotId);
      break;
      
    default:
      console.log(`
📸 EAS Tracker Snapshot Manager

Usage:
  node scripts/snapshot.js <command> [options]

Commands:
  create [name]    Create snapshot
  list             List snapshots  
  restore <id>     Restore snapshot

Examples:
  node scripts/snapshot.js create
  node scripts/snapshot.js create "Before changes"
  node scripts/snapshot.js list
  node scripts/snapshot.js restore c1a2b3d4-e5f6-7890-abcd-ef1234567890
      `);
  }
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = { createSnapshot, listSnapshots, restoreSnapshot };
