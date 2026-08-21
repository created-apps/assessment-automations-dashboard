import { runAssessmentCompletions } from './assessment-completions';

/**
 * Run one assessment-completion check and exit -- for testing without waiting
 * for the hourly cron.
 *
 *   npm run check-assessments
 */
runAssessmentCompletions()
  .then((summary) => {
    console.log('assessment completions:', summary);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
