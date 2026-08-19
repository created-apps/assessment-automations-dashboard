import { runMentorNudge } from './scheduler';

/** Run the daily nudge by hand: `npm run nudge`. */
runMentorNudge()
  .then((summary) => console.log(summary))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
