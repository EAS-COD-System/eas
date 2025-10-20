#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

// Backup destinations (configure these for your setup)
const BACKUP_DESTINATIONS = [
  // Local backup (keep 7 days)
  path.join(ROOT, 'data', 'backups', 'local'),
  
  // Add your remote backup destinations here:
  // '/path/to/network/share/eas-backups',
  // '/mnt/external-drive/eas-backups',
  // 'user@remote-server:/backup/eas-tracker'
];

// Cloud storage configurations (uncomment and configure as needed)
const CLOUD_CONFIG = {
  // AWS S3 example:
  // s3: {
  //   bucket: 'your-backup-bucket',
  //   region: 'us-east-1',
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  // },
  
  // Google Drive example (would need rclone setup):
  // gdrive: {
  //   remoteName: 'your-google-drive',
  //   folderId: 'your-folder-id'
  // },
  
  // Dropbox example:
  // dropbox: {
  //   accessToken: process.env.DROPBOX_ACCESS_TOKEN
  // }
};

async function ensureBackupDirs() {
  for (const dest of BACKUP_DESTINATIONS) {
    await fs.ensureDir(dest);
  }
  await fs.ensureDir(BACKUP_DIR);
}

async function createBackup() {
  try {
    console.log('🔄 Starting EAS Tracker backup...');
    await ensureBackupDirs();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `auto-${timestamp}`;
    
    // Create backup entry in database
    const db = await fs.readJson(DATA_FILE);
    db.snapshots = db.snapshots || [];
    
    const backupEntry = {
      id: uuidv4(),
      name: backupId,
      file: path.join(BACKUP_DIR, `${backupId}.json`),
      createdAt: new Date().toISOString(),
      kind: 'auto'
    };
    
    // Create backup file
    const backupData = {
      metadata: {
        version: '1.0',
        backupId: backupId,
        timestamp: new Date().toISOString(),
        dataSize: JSON.stringify(db).length
      },
      data: db
    };
    
    const backupFile = path.join(BACKUP_DIR, `${backupId}.json`);
    await fs.writeJson(backupFile, backupData, { spaces: 2 });
    
    // Add to snapshots list
    db.snapshots.unshift(backupEntry);
    await fs.writeJson(DATA_FILE, db, { spaces: 2 });
    
    console.log('✅ Local backup created:', backupId);
    
    // Copy to all backup destinations
    await copyToBackupDestinations(backupFile, backupId);
    
    // Upload to cloud storage (if configured)
    await uploadToCloud(backupFile, backupId);
    
    // Clean up old backups (keep last 30 days locally, 7 days in other destinations)
    await cleanupOldBackups();
    
    console.log('🎉 Backup completed successfully!');
    return backupId;
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  }
}

async function copyToBackupDestinations(backupFile, backupId) {
  for (const dest of BACKUP_DESTINATIONS.slice(1)) { // Skip first (local)
    try {
      if (dest.includes('@')) {
        // Remote server via SCP
        await execPromise(`scp "${backupFile}" "${dest}/${backupId}.json"`);
      } else {
        // Local/network path
        const destFile = path.join(dest, `${backupId}.json`);
        await fs.copy(backupFile, destFile);
      }
      console.log(`✅ Copied to: ${dest}`);
    } catch (error) {
      console.error(`❌ Failed to copy to ${dest}:`, error.message);
    }
  }
}

async function uploadToCloud(backupFile, backupId) {
  // AWS S3 Upload
  if (CLOUD_CONFIG.s3) {
    try {
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      const s3Client = new S3Client(CLOUD_CONFIG.s3);
      
      const fileContent = await fs.readFile(backupFile);
      const command = new PutObjectCommand({
        Bucket: CLOUD_CONFIG.s3.bucket,
        Key: `eas-tracker/${backupId}.json`,
        Body: fileContent,
        ContentType: 'application/json'
      });
      
      await s3Client.send(command);
      console.log('✅ Uploaded to AWS S3');
    } catch (error) {
      console.error('❌ AWS S3 upload failed:', error.message);
    }
  }
  
  // Add other cloud providers as needed
  // Google Drive, Dropbox, etc.
}

async function cleanupOldBackups() {
  const now = new Date();
  const localKeepDays = 30;
  const remoteKeepDays = 7;
  
  try {
    // Clean local backups (keep 30 days)
    const localBackupDir = BACKUP_DESTINATIONS[0];
    const files = await fs.readdir(localBackupDir);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(localBackupDir, file);
        const stats = await fs.stat(filePath);
        const fileAgeDays = (now - stats.mtime) / (1000 * 60 * 60 * 24);
        
        if (fileAgeDays > localKeepDays) {
          await fs.remove(filePath);
          console.log(`🗑️  Deleted old local backup: ${file}`);
        }
      }
    }
    
    // Clean main backup directory (keep 30 days)
    const backupFiles = await fs.readdir(BACKUP_DIR);
    for (const file of backupFiles) {
      if (file.endsWith('.json') && file.startsWith('auto-')) {
        const filePath = path.join(BACKUP_DIR, file);
        const stats = await fs.stat(filePath);
        const fileAgeDays = (now - stats.mtime) / (1000 * 60 * 60 * 24);
        
        if (fileAgeDays > localKeepDays) {
          await fs.remove(filePath);
          console.log(`🗑️  Deleted old backup: ${file}`);
        }
      }
    }
    
    // Clean remote destinations (keep 7 days)
    for (const dest of BACKUP_DESTINATIONS.slice(1)) {
      if (!dest.includes('@')) {
        // Local/network path
        try {
          const files = await fs.readdir(dest);
          for (const file of files) {
            if (file.endsWith('.json')) {
              const filePath = path.join(dest, file);
              const stats = await fs.stat(filePath);
              const fileAgeDays = (now - stats.mtime) / (1000 * 60 * 60 * 24);
              
              if (fileAgeDays > remoteKeepDays) {
                await fs.remove(filePath);
                console.log(`🗑️  Deleted old remote backup: ${file}`);
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error cleaning ${dest}:`, error.message);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
  }
}

function execPromise(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

// List available backups
async function listBackups() {
  try {
    console.log('📂 Available Backups:');
    console.log('='.repeat(50));
    
    const files = await fs.readdir(BACKUP_DIR);
    const backupFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
    
    for (const file of backupFiles) {
      const filePath = path.join(BACKUP_DIR, file);
      const stats = await fs.stat(filePath);
      console.log(`📁 ${file}`);
      console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`   Modified: ${stats.mtime.toLocaleString()}`);
      console.log('');
    }
    
    if (backupFiles.length === 0) {
      console.log('No backups found.');
    }
    
  } catch (error) {
    console.error('❌ Error listing backups:', error.message);
  }
}

// Main function
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'create':
    case 'c':
      await createBackup();
      break;
      
    case 'list':
    case 'ls':
      await listBackups();
      break;
      
    case 'cleanup':
      await cleanupOldBackups();
      break;
      
    case 'help':
    case 'h':
    case undefined:
      console.log(`
🛡️ EAS Tracker Backup Manager

Usage:
  node backup.js <command>

Commands:
  create, c     Create a new backup
  list, ls      List all available backups
  cleanup       Clean up old backups manually
  help, h       Show this help message

Automated Backups:
  Add to crontab for daily backups at 2 AM:
  0 2 * * * cd /path/to/eas-tracker && node backup.js create

Backup Destinations:
  Configure BACKUP_DESTINATIONS in backup.js for:
  - Local backups (30 days retention)
  - Network shares
  - Remote servers (via SCP)
  - Cloud storage (AWS S3, etc.)

Environment Variables:
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY for S3
  DROPBOX_ACCESS_TOKEN for Dropbox
      `);
      break;
      
    default:
      console.error('❌ Unknown command:', command);
      console.log('Use "node backup.js help" for usage information.');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { createBackup, listBackups, cleanupOldBackups };
