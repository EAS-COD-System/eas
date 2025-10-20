#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function listBackups() {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const backupFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
    
    console.log('\n📂 Available Backups:');
    console.log('='.repeat(50));
    
    backupFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });
    
    return backupFiles;
  } catch (error) {
    console.error('❌ Error listing backups:', error.message);
    return [];
  }
}

async function restoreBackup(backupFile) {
  try {
    const backupPath = path.join(BACKUP_DIR, backupFile);
    
    // Verify backup exists
    if (!await fs.pathExists(backupPath)) {
      throw new Error(`Backup file not found: ${backupFile}`);
    }
    
    // Read backup data
    const backupData = await fs.readJson(backupPath);
    
    // Verify backup structure
    if (!backupData.data || !backupData.metadata) {
      throw new Error('Invalid backup file format');
    }
    
    // Create backup of current data before restore
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const currentBackup = path.join(BACKUP_DIR, `pre-restore-${timestamp}.json`);
    const currentData = await fs.readJson(DATA_FILE);
    
    await fs.writeJson(currentBackup, {
      metadata: {
        version: '1.0',
        type: 'pre-restore',
        timestamp: new Date().toISOString(),
        originalFile: DATA_FILE
      },
      data: currentData
    }, { spaces: 2 });
    
    console.log('✅ Current data backed up to:', path.basename(currentBackup));
    
    // Restore the backup
    await fs.writeJson(DATA_FILE, backupData.data, { spaces: 2 });
    
    console.log('✅ Restore completed successfully!');
    console.log(`📊 Restored from: ${backupFile}`);
    console.log(`📅 Backup date: ${backupData.metadata.timestamp}`);
    console.log(`💾 Data size: ${backupData.metadata.dataSize} bytes`);
    
  } catch (error) {
    console.error('❌ Restore failed:', error.message);
    process.exit(1);
  }
}

async function main() {
  try {
    console.log('🛡️ EAS Tracker Restore Manager');
    console.log('='.repeat(40));
    
    // List available backups
    const backups = await listBackups();
    
    if (backups.length === 0) {
      console.log('\n❌ No backups found in:', BACKUP_DIR);
      process.exit(1);
    }
    
    // Ask user to select backup
    const choice = await question('\n🔢 Enter the number of the backup to restore: ');
    const index = parseInt(choice) - 1;
    
    if (isNaN(index) || index < 0 || index >= backups.length) {
      console.log('❌ Invalid selection');
      process.exit(1);
    }
    
    const selectedBackup = backups[index];
    
    // Confirm restoration
    console.log(`\n⚠️  WARNING: This will overwrite ALL current data!`);
    console.log(`📁 You are about to restore: ${selectedBackup}`);
    
    const confirm = await question('❓ Are you sure you want to continue? (yes/NO): ');
    
    if (confirm.toLowerCase() !== 'yes') {
      console.log('❌ Restore cancelled.');
      process.exit(0);
    }
    
    // Perform restore
    await restoreBackup(selectedBackup);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { restoreBackup, listBackups };
