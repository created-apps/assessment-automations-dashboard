import { runMentorJoinCheck } from './mentor-join';
import { refreshMentors } from './mentors';

/**
 * Run the mentor-join check once, outside the cron:
 *
 *   npm run mentor-join
 */
async function main() {
  await refreshMentors();
  console.log(await runMentorJoinCheck());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
