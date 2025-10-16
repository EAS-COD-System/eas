const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ROOT = __dirname;
grep -n "DATA_FILE" server.js snapshot.js
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

async function createSnapshot(name = null) {
  try {
    await fs.ensureDir(SNAPSHOT_DIR);
    
    const db = await fs.readJson(DATA_FILE);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotName = name || `Manual-${stamp}`;
    const snapshotFile = path.join(SNAPSHOT_DIR, `${stamp}-${snapshotName.replace(/\s+/g, '_')}.json`);
    
    await fs.copy(DATA_FILE, snapshotFile);
    
    const snapshotEntry = {
      id: uuidv4(),
      name: snapshotName,
      file: snapshotFile,
      createdAt: new Date().toISOString(),
      kind: 'manual'
    };
    
    db.snapshots = db.snapshots || [];
    db.snapshots.unshift(snapshotEntry);
    await fs.writeJson(DATA_FILE, db, { spaces: 2 });
    
    console.log('✅ Snapshot created successfully!');
    console.log(`📁 File: ${path.basename(snapshotFile)}`);
    console.log(`📛 Name: ${snapshotName}`);
    
  } catch (error) {
    console.error('❌ Error creating snapshot:', error.message);
  }
}

async function listSnapshots() {
  try {
    const db = await fs.readJson(DATA_FILE);
    const snapshots = db.snapshots || [];
    
    console.log('📸 Available Snapshots:');
    console.log('='.repeat(50));
    
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

async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'create':
    case 'c':
      await createSnapshot(process.argv[3]);
      break;
      
    case 'list':
    case 'ls':
      await listSnapshots();
      break;
      
    case 'help':
    case 'h':
    case undefined:
      console.log(`
📸 EAS Tracker Snapshot Manager

Usage:
  node snapshot.js <command> [options]

Commands:
  create [name]    Create a new snapshot
  list             List all available snapshots
  help             Show this help message

Examples:
  node snapshot.js create
  node snapshot.js create "Backup name"
  node snapshot.js list
      `);
      break;
      
    default:
      console.error('❌ Unknown command:', command);
      console.log('Use "node snapshot.js help" for usage information.');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { createSnapshot, listSnapshots };
