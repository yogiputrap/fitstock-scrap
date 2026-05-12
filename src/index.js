import { config } from './config.js';
import { logger } from './logger.js';
import { initScraper, fetchPicks, closeScraper } from './scraper.js';
import { initWhatsApp, sendText, getStatus } from './whatsapp.js';
import { startHttp } from './server.js';
import { has, add, keyOf } from './store.js';
import { formatPickMessage } from './format.js';
import { tickStats } from './state.js';

let stopping = false;
let baselineLoaded = false;

async function tick() {
  if (stopping) return;

  tickStats.count += 1;
  tickStats.lastTickAt = new Date().toISOString();

  let picks = [];
  try {
    picks = await fetchPicks();
  } catch (err) {
    logger.warn({ err: err.message }, 'fetchPicks threw');
    return;
  }

  tickStats.lastPickCount = picks.length;

  if (!picks.length) {
    logger.debug({ tick: tickStats.count }, 'tick: no picks extracted');
    return;
  }

  // First successful poll: baseline existing picks.
  if (!baselineLoaded) {
    baselineLoaded = true;
    if (config.notifyOnStartup) {
      logger.info({ count: picks.length }, 'startup: notifying current picks');
    } else {
      for (const p of picks) add(keyOf(p), { ticker: p.ticker, baseline: true });
      logger.info({ tick: tickStats.count, count: picks.length }, 'baseline recorded (not notifying)');
      return;
    }
  }

  const fresh = picks.filter((p) => !has(keyOf(p)));
  tickStats.lastNewCount = fresh.length;

  logger.info(
    { tick: tickStats.count, total: picks.length, new: fresh.length },
    'tick complete',
  );

  if (!fresh.length) return;

  const waReady = getStatus().ready;
  let sent = 0;
  for (const pick of fresh) {
    const key = keyOf(pick);
    const body = formatPickMessage(pick);

    if (!waReady) {
      logger.warn({ ticker: pick.ticker }, 'WA not ready, will retry next cycle');
      continue;
    }
    try {
      await sendText(body);
      add(key, { ticker: pick.ticker });
      sent += 1;
      logger.info({ ticker: pick.ticker, pickTime: pick.pickTime }, 'sent pick to WA');
    } catch (err) {
      logger.error({ err: err.message, ticker: pick.ticker }, 'send failed');
    }
  }
  tickStats.lastSentCount = sent;
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
