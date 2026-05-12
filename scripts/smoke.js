// Quick smoke test - loads the site once and prints extracted picks.
// Run with: node scripts/smoke.js
import { initScraper, fetchPicks, closeScraper } from '../src/scraper.js';

process.env.TARGET_URL ??= 'https://fitstock.id/#sec-spil';
process.env.WA_SENDER ??= '0';
process.env.WA_TARGET ??= '0';
process.env.LOG_LEVEL = 'warn';

try {
  console.log('launching browser...');
  await initScraper();
  console.log('fetching picks...');
  const picks = await fetchPicks();
  console.log(`\n--- got ${picks.length} picks ---\n`);
  for (const p of picks.slice(0, 10)) {
    console.log(JSON.stringify(p, null, 2));
  }
} catch (err) {
  console.error('error:', err);
  process.exitCode = 1;
} finally {
  await closeScraper();
}
