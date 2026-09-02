import { runFirstClassChase } from './first-class';
import { refreshMentors } from './mentors';

/**
 * Run the first-class chase once, outside the cron:
 *
 *   npm run first-class
 *
 * It sends real WhatsApp messages -- the same ones the 10:00 job would.
 */
async function main() {
  await refreshMentors();
  console.log(await runFirstClassChase());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
