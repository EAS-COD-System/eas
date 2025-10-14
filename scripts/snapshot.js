#!/usr/bin/env node

/**
 * EAS Tracker Snapshot Management Tool
 * Command-line utility for database backups and restoration
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT_DIR, 'data', 'db.json');
const SNAPSHOT_DIR = path.join(ROOT_DIR, 'data', 'snapshots');
const DATA_DIR = path.dirname(DATA_FILE);

class SnapshotManager {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    fs.ensureDirSync(DATA_DIR);
    fs.ensureDirSync(SNAPSHOT_DIR);
  }

  async createSnapshot(name = '') {
    try {
      // Load current database to update snapshots list
      const db = await fs.readJson(DATA_FILE);
      
      const snapshotName = name.trim() || `Manual-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotFile = path.join(SNAPSHOT_DIR, `${timestamp}-${snapshotName.replace(/\s+/g, '_')}.json`);
      
      // Create the snapshot
      await fs.copy(DATA_FILE, snapshotFile);
      
      // Create snapshot entry
      const snapshotEntry = {
        id: uuidv4(),
        name: snapshotName,
        file: snapshotFile,
        createdAt: new Date().toISOString(),
        kind: 'manual',
        size: (await fs.stat(snapshotFile)).size
      };

      // Update database with snapshot entry
      db.systemData = db.systemData || {};
      db.systemData.snapshots = db.systemData.snapshots || [];
      db.systemData.snapshots.unshift(snapshotEntry);
      
      await fs.writeJson(DATA_FILE, db, { spaces: 2 });

      return {
        success: true,
        snapshot: snapshotEntry,
        message: `Snapshot created: ${snapshotName}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async listSnapshots() {
    try {
      const db = await fs.readJson(DATA_FILE);
      const snapshots = db.systemData?.snapshots || [];
      
      return {
        success: true,
        snapshots: snapshots.map(snap => ({
          id: snap.id,
          name: snap.name,
          date: new Date(snap.createdAt).toLocaleString(),
          size: this.formatFileSize(snap.size),
          file: path.basename(snap.file)
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async restoreSnapshot(snapshotId) {
    try {
      const db = await fs.readJson(DATA_FILE);
      const snapshot = db.systemData?.snapshots?.find(s => s.id === snapshotId);
      
      if (!snapshot) {
        return {
          success: false,
          error: `Snapshot with ID ${snapshotId} not found`
        };
      }

      if (!await fs.pathExists(snapshot.file)) {
        return {
          success: false,
          error: `Snapshot file not found: ${snapshot.file}`
        };
      }

      // Create backup of current database
      const backupFile = path.join(SNAPSHOT_DIR, `pre-restore-backup-${Date.now()}.json`);
      await fs.copy(DATA_FILE, backupFile);

      // Restore from snapshot
      await fs.copy(snapshot.file, DATA_FILE);

      return {
        success: true,
        message: `Database restored from snapshot: ${snapshot.name}`,
        backup: path.basename(backupFile),
        restored: path.basename(snapshot.file)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async deleteSnapshot(snapshotId) {
    try {
      const db = await fs.readJson(DATA_FILE);
      const snapshotIndex = db.systemData?.snapshots?.findIndex(s => s.id === snapshotId);
      
      if (snapshotIndex === -1) {
        return {
          success: false,
          error: `Snapshot with ID ${snapshotId} not found`
        };
      }

      const snapshot = db.systemData.snapshots[snapshotIndex];

      // Delete the snapshot file
      if (await fs.pathExists(snapshot.file)) {
        await fs.remove(snapshot.file);
      }

      // Remove from database
      db.systemData.snapshots.splice(snapshotIndex, 1);
      await fs.writeJson(DATA_FILE, db, { spaces: 2 });

      return {
        success: true,
        message: `Snapshot deleted: ${snapshot.name}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  async getDatabaseInfo() {
    try {
      const stats = await fs.stat(DATA_FILE);
      const db = await fs.readJson(DATA_FILE);
      
      return {
        file: DATA_FILE,
        size: this.formatFileSize(stats.size),
        products: db.products?.length || 0,
        countries: db.business?.countries?.length || 0,
        snapshots: db.systemData?.snapshots?.length || 0,
        lastModified: stats.mtime
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }
}

// Command Line Interface
async function main() {
  const manager = new SnapshotManager();
  const command = process.argv[2];
  const argument = process.argv[3];

  switch (command) {
    case 'create':
    case 'c': {
      const result = await manager.createSnapshot(argument);
      if (result.success) {
        console.log('✅', result.message);
        console.log('📁 File:', path.basename(result.snapshot.file));
        console.log('📛 Name:', result.snapshot.name);
        console.log('🕐 Created:', new Date(result.snapshot.createdAt).toLocaleString());
      } else {
        console.error('❌', result.error);
        process.exit(1);
      }
      break;
    }

    case 'list':
    case 'ls':
    case 'l': {
      const result = await manager.listSnapshots();
      if (result.success) {
        console.log('📸 Available Snapshots:');
        console.log('='.repeat(80));
        
        if (result.snapshots.length === 0) {
          console.log('No snapshots found.');
        } else {
          result.snapshots.forEach((snap, index) => {
            console.log(`${index + 1}. ${snap.name}`);
            console.log(`   ID: ${snap.id}`);
            console.log(`   Date: ${snap.date}`);
            console.log(`   Size: ${snap.size}`);
            console.log(`   File: ${snap.file}`);
            console.log('');
          });
        }
      } else {
        console.error('❌', result.error);
        process.exit(1);
      }
      break;
    }

    case 'restore':
    case 'r': {
      if (!argument) {
        console.error('❌ Please provide snapshot ID');
        console.log('Usage: node scripts/snapshot.js restore <snapshot-id>');
        process.exit(1);
      }

      const result = await manager.restoreSnapshot(argument);
      if (result.success) {
        console.log('✅', result.message);
        console.log('📁 Restored from:', result.restored);
        console.log('💾 Backup created:', result.backup);
        console.log('🔄 Please restart your application.');
      } else {
        console.error('❌', result.error);
        process.exit(1);
      }
      break;
    }

    case 'delete':
    case 'd': {
      if (!argument) {
        console.error('❌ Please provide snapshot ID');
        console.log('Usage: node scripts/snapshot.js delete <snapshot-id>');
        process.exit(1);
      }

      const result = await manager.deleteSnapshot(argument);
      if (result.success) {
        console.log('✅', result.message);
      } else {
        console.error('❌', result.error);
        process.exit(1);
      }
      break;
    }

    case 'info':
    case 'i': {
      const info = await manager.getDatabaseInfo();
      if (info.error) {
        console.error('❌', info.error);
        process.exit(1);
      } else {
        console.log('📊 Database Information:');
        console.log('='.repeat(40));
        console.log('File:', info.file);
        console.log('Size:', info.size);
        console.log('Products:', info.products);
        console.log('Countries:', info.countries);
        console.log('Snapshots:', info.snapshots);
        console.log('Last Modified:', info.lastModified.toLocaleString());
      }
      break;
    }

    case 'help':
    case 'h':
    case undefined: {
      console.log(`
📸 EAS Tracker Snapshot Manager v2.0.0

Usage:
  node scripts/snapshot.js <command> [argument]

Commands:
  create [name]    Create a new snapshot (optional name)
  list             List all available snapshots
  restore <id>     Restore database from snapshot (by ID)
  delete <id>      Delete a snapshot (by ID)
  info             Show database information
  help             Show this help message

Examples:
  node scripts/snapshot.js create
  node scripts/snapshot.js create "Before major changes"
  node scripts/snapshot.js list
  node scripts/snapshot.js restore c1a2b3d4-e5f6-7890-abcd-ef1234567890
  node scripts/snapshot.js delete c1a2b3d4-e5f6-7890-abcd-ef1234567890
  node scripts/snapshot.js info
      `);
      break;
    }

    default: {
      console.error('❌ Unknown command:', command);
      console.log('Use "node scripts/snapshot.js help" for usage information.');
      process.exit(1);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = SnapshotManager;
