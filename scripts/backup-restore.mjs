#!/usr/bin/env node
/**
 * Black Sands Exchange — CLI Backup & Restore Utility
 *
 * Usage:
 *   npm run backup [optional-output.json]
 *   npm run restore -- <backup-file.json | cloud-backup-id>
 *   node scripts/backup-restore.mjs list
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { FirestoreClient } from '../src/firestore.js';
import {
  buildBackupEnvelope,
  createCloudBackup,
  listCloudBackups,
  restoreBseStateFromBackup
} from '../src/backups.js';

dotenv.config({ path: '.dev.vars' });

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    console.log('Usage:\n  npm run backup [optional-output.json]\n  npm run restore -- <backup-file.json | cloud-backup-id>\n  node scripts/backup-restore.mjs list');
    return;
  }
  const [command = 'backup', targetArg] = args;
  const firestore = new FirestoreClient(process.env);

  if (command === 'list') {
    const backups = await listCloudBackups(firestore, { limit: 40 });
    if (!backups.length) {
      console.log('No cloud backups found yet.');
      return;
    }
    console.log(`Found ${backups.length} cloud backup snapshot(s):`);
    for (const b of backups) {
      const s = b.stats || {};
      console.log(
        `  • ${b.id} [${b.kind}] ${b.createdAt} — "${b.label}" ` +
        `(${s.walletCount ?? 0} wallets, ${s.totalBounties ?? 0} bounties, ${s.totalCareerScore ?? 0} career pts)`
      );
    }
    return;
  }

  if (command === 'backup') {
    const state = await firestore.getBseState();
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = targetArg
      ? path.resolve(targetArg)
      : path.resolve('backups', `bse_backup_${stamp}.json`);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const envelope = buildBackupEnvelope(state, {
      id: `cli_${now.getTime()}`,
      createdAt: now.toISOString(),
      kind: 'manual',
      label: 'CLI Backup Export',
      createdBy: 'CLI'
    });

    fs.writeFileSync(outPath, JSON.stringify(envelope, null, 2), 'utf8');
    console.log(`✅ Saved local JSON backup to: ${outPath}`);
    console.log(
      `   Summary: ${envelope.stats.walletCount} wallets, ${envelope.stats.totalBounties} bounties, ` +
      `${envelope.stats.totalSpendableBones} spendable Bones, ${envelope.stats.totalCareerScore} career score.`
    );

    if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
      try {
        const cloud = await createCloudBackup(firestore, state, {
          kind: 'manual',
          label: 'CLI Manual Backup',
          createdBy: 'CLI',
          now
        });
        console.log(`☁️  Also saved cloud snapshot in Firestore: ${cloud.id}`);
      } catch (err) {
        console.warn(`⚠️  Local file saved, cloud snapshot skipped: ${err.message}`);
      }
    }
    return;
  }

  if (command === 'restore') {
    if (!targetArg) {
      console.error('❌ Usage: npm run restore -- <path/to/backup.json | cloud_backup_id>');
      process.exit(1);
    }

    const candidatePath = path.resolve(targetArg);
    let result;
    if (fs.existsSync(candidatePath)) {
      const rawJson = fs.readFileSync(candidatePath, 'utf8');
      result = await restoreBseStateFromBackup({
        firestore,
        backupData: rawJson,
        officerName: 'CLI Admin',
        reason: `Restored from local file ${path.basename(candidatePath)}`
      });
    } else {
      result = await restoreBseStateFromBackup({
        firestore,
        backupId: targetArg,
        officerName: 'CLI Admin',
        reason: `Restored via CLI from cloud ID ${targetArg}`
      });
    }

    console.log(`✅ Successfully restored ${result.restoredFrom}!`);
    if (result.safetyBackup?.id) {
      console.log(`🛡️  Pre-restore safety snapshot saved as: ${result.safetyBackup.id}`);
    }
    console.log(
      `   Restored stats: ${result.stats.walletCount} wallets, ${result.stats.totalBounties} bounties, ` +
      `${result.stats.totalCareerScore} career score.`
    );
    return;
  }

  console.error(`Unknown command "${command}". Supported: backup, restore, list`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal backup/restore error:', err.message);
  process.exit(1);
});
