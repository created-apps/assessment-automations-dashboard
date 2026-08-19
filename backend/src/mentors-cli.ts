import { allMentors, findMentor, introFor, refreshMentors } from './mentors';

/**
 * Check what a typed name resolves to before trusting it in a live thread:
 *
 *   npm run mentors -- "nirupma"
 *   npm run mentors            # lists the directory
 */
async function main() {
  // Include dashboard-added mentors, not just the JSON seed.
  await refreshMentors();

  const query = process.argv.slice(2).join(' ').trim();

  if (!query) {
    const mentors = allMentors();
    console.log(`${mentors.length} mentors:`);
    for (const m of mentors) {
      const variants = m.variants ? ` [${Object.keys(m.variants).join(', ')}]` : '';
      console.log(`  ${m.name}${variants}`);
    }
    return;
  }

  const match = findMentor(query);
  console.log(`query: "${query}" -> ${match.status}`);
  for (const c of match.candidates) {
    console.log(`  ${c.score.toFixed(3)}  ${c.item.name}`);
  }
  if (match.status === 'matched' && match.best) {
    console.log(`\n--- intro sent to the group ---\n${introFor(match.best.item)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
