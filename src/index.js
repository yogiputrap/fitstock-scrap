import { config } from './config.js';
import { logger } from './logger.js';
import { initScraper, fetchPicks, closeScraper } from './scraper.js';
import { initWhatsApp, sendText, getStatus } from './whatsapp.js';
import { startHttp } from './server.js';
import { has, add, keyOf } from './store.js';
import { formatPickMessage } from './format.js';

let stopping = false;
let baselineLoaded = false;

async function tick() {
  if (stopping) return;

  let picks = [];
  try {
    picks = await fetchPicks();
  } catch (err) {
    logger.warn({ err: err.message }, 'fetchPicks threw');
    return;
  }

  if (!picks.length) {
    logger.debug('no picks extracted this cycle');
    return;
  }

  // First successful poll: baseline existing picks.
  if (!baselineLoaded) {
    baselineLoaded = true;
    if (config.notifyOnStartup) {
      logger.info({ count: picks.length }, 'startup: notifying current picks');
    } else {
      for (const p of picks) add(keyOf(p), { ticker: p.ticker, baseline: true });
      logger.info({ count: picks.length }, 'baseline recorded (not notifying)');
      return;
    }
  }

  const fresh = picks.filter((p) => !has(keyOf(p)));
  if (!fresh.length) return;

  const waReady = getStatus().ready;
  for (const pick of fresh) {
    const key = keyOf(pick);
    const body = formatPickMessage(pick);

    if (!waReady) {
      logger.warn({ ticker: pick.ticker }, 'WA not ready, skipping (will retry next cycle)');
      // do NOT mark as seen; let a future cycle send it once connected
      continue;
    }
    try {
      await sendText(body);
      add(key, { ticker: pick.ticker });
      logger.info({ ticker: pick.ticker, pickTime: pick.pickTime }, 'sent pick');
    } catch (err) {
      logger.error({ err: err.message, ticker: pick.ticker }, 'send failed');
      // don't mark as seen so we retry next cycle
    }
  }
}

async function main() {
  logger.info(
    { url: config.targetUrl, interval: config.pollIntervalMs, target: config.waTarget },
    'starting FITStock WA alert',
  );

  startHttp();
  await initWhatsApp();
  await initScraper();

  // Run immediately, then on interval
  await tick();
  const timer = setInterval(() => {
    tick().catch((err) => logger.error({ err: err.message }, 'tick error'));
  }, config.pollIntervalMs);

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(timer);
    await closeScraper();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, 'fatal');
  process.exit(1);
});
