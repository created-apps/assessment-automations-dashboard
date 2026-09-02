import { applyPhoneBackfill, planPhoneBackfill } from './mentor-phone-backfill';

/**
 * Fill in the mentor phone numbers we don't have, from SYNC.
 *
 *   npm run mentors:phones           # show what would be written
 *   npm run mentors:phones -- --apply
 *
 * Dry by default: a number written against the wrong mentor is not something
 * a second run would notice, so the plan is meant to be read before it runs.
 */
async function main() {
  const apply = process.argv.includes('--apply');

  const summary = await planPhoneBackfill();

  console.log(
    `${summary.considered} mentors in the directory, ` +
      `${summary.alreadyHadPhone} already have a number here.\n`
  );

  if (summary.planned.length === 0) {
    console.log('Nothing to backfill.');
  } else {
    console.log(`${summary.planned.length} to fill in from SYNC:`);
    for (const p of summary.planned) {
      const via = p.how === 'name' ? '' : `  (matched by ${p.how}: "${p.syncName}")`;
      console.log(`  ${p.action.padEnd(6)} ${p.name.padEnd(24)} ${p.phone}${via}`);
    }
  }

  if (summary.skipped.length > 0) {
    console.log(`\n${summary.skipped.length} left alone:`);
    for (const s of summary.skipped) {
      console.log(`  ${s.name.padEnd(24)} ${s.reason}${s.detail ? ` -- ${s.detail}` : ''}`);
    }
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write these.');
    return;
  }

  console.log('\nWriting...');
  await applyPhoneBackfill(summary);
  console.log(`patched ${summary.patched}, inserted ${summary.inserted}, failed ${summary.failed.length}`);
  for (const f of summary.failed) {
    console.log(`  ${f.name}: ${f.error}`);
  }
  if (summary.failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
