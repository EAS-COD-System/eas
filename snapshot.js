// snapshot.js - Manual database snapshot tool
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

async function createSnapshot() {
  try {
    // Ensure snapshot directory exists
    await fs.ensureDir(SNAPSHOT_DIR);
    
    // Load current database to include in snapshots list
    const db = await fs.readJson(DATA_FILE);
    
    // Create snapshot filename with timestamp
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = process.argv[2] || `Manual-${stamp}`;
    const snapshotFile = path.join(SNAPSHOT_DIR, `${stamp}-${name.replace(/\s+/g, '_')}.json`);
    
    // Copy the database file to snapshot
    await fs.copy(DATA_FILE, snapshotFile);
    
    // Create snapshot entry
    const snapshotEntry = {
      id: uuidv4(),
      name: name,
      file: snapshotFile,
      createdAt: new Date().toISOString(),
      kind: 'manual'
    };
    
    // Update the snapshots list in the database
    db.snapshots = db.snapshots || [];
    db.snapshots.unshift(snapshotEntry);
    
    // Save the updated database
    await fs.writeJson(DATA_FILE, db, { spaces: 2 });
    
    console.log('✅ Snapshot created successfully!');
    console.log(`📁 File: ${path.basename(snapshotFile)}`);
    console.log(`📛 Name: ${name}`);
    console.log(`🕐 Created: ${new Date().toLocaleString()}`);
    
  } catch (error) {
    console.error('❌ Error creating snapshot:', error.message);
    process.exit(1);
  }
}

async function listSnapshots() {
  try {
    const db = await fs.readJson(DATA_FILE);
    const snapshots = db.snapshots || [];
    
    console.log('📸 Available Snapshots:');
    console.log('=' .repeat(50));
    
    if (snapshots.length === 0) {
      console.log('No snapshots found.');
      return;
    }
    
    snapshots.forEach((snap, index) => {
      console.log(`${index + 1}. ${snap.name}`);
      console.log(`   File: ${path.basename(snap.file)}`);
      console.log(`   Date: ${new Date(snap.createdAt).toLocaleString()}`);
      console.log(`   ID: ${snap.id}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error listing snapshots:', error.message);
  }
}

async function restoreSnapshot(snapshotIdOrName) {
  try {
    const db = await fs.readJson(DATA_FILE);
    const snapshots = db.snapshots || [];
    
    // Find snapshot by ID or name
    const snapshot = snapshots.find(snap => 
      snap.id === snapshotIdOrName || 
      snap.name.toLowerCase().includes(snapshotIdOrName.toLowerCase())
    );
    
    if (!snapshot) {
      console.error('❌ Snapshot not found:', snapshotIdOrName);
      return;
    }
    
    if (!await fs.pathExists(snapshot.file)) {
      console.error('❌ Snapshot file not found:', snapshot.file);
      return;
    }
    
    // Create backup of current database before restore
    const backupFile = path.join(SNAPSHOT_DIR, `pre-restore-backup-${Date.now()}.json`);
    await fs.copy(DATA_FILE, backupFile);
    
    // Restore from snapshot
    await fs.copy(snapshot.file, DATA_FILE);
    
    console.log('✅ Database restored successfully!');
    console.log(`📁 From: ${path.basename(snapshot.file)}`);
    console.log(`📛 Snapshot: ${snapshot.name}`);
    console.log(`💾 Backup: ${path.basename(backupFile)}`);
    console.log('🔄 Please restart your application.');
    
  } catch (error) {
    console.error('❌ Error restoring snapshot:', error.message);
  }
}

// Command line interface
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'create':
    case 'c':
      const name = process.argv[3];
      await createSnapshot(name);
      break;
      
    case 'list':
    case 'ls':
    case 'l':
      await listSnapshots();
      break;
      
    case 'restore':
    case 'r':
      const snapshotId = process.argv[3];
      if (!snapshotId) {
        console.error('❌ Please provide snapshot ID or name');
        console.log('Usage: node snapshot.js restore <snapshot-id-or-name>');
        return;
      }
      await restoreSnapshot(snapshotId);
      break;
      
    case 'help':
    case 'h':
    case undefined:
      console.log(`
📸 EAS Tracker Snapshot Manager

Usage:
  node snapshot.js <command> [options]

Commands:
  create [name]    Create a new snapshot (optional: provide a name)
  list             List all available snapshots
  restore <id>     Restore database from snapshot (by ID or name)
  help             Show this help message

Examples:
  node snapshot.js create
  node snapshot.js create "Before major changes"
  node snapshot.js list
  node snapshot.js restore "Before major changes"
  node snapshot.js restore c1a2b3d4-e5f6-7890-abcd-ef1234567890
      `);
      break;
      
    default:
      console.error('❌ Unknown command:', command);
      console.log('Use "node snapshot.js help" for usage information.');
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  createSnapshot,
  listSnapshots,
  restoreSnapshot
};
