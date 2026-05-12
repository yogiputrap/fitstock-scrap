import { chromium } from 'playwright';
import { config } from './config.js';
import { logger } from './logger.js';

let browser = null;
let context = null;
let page = null;

async function launch() {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  });
  // Block heavy assets to keep polling lightweight
  await context.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
    return route.continue();
  });
  page = await context.newPage();
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

export async function initScraper() {
  if (!browser) await launch();
}

export async function closeScraper() {
  try {
    await page?.close();
    await context?.close();
    await browser?.close();
  } catch {
    // ignore
  } finally {
    browser = null;
    context = null;
    page = null;
  }
}

// DOM-side extractor. Runs inside the page. Returns an array of picks.
// Strategy: find the "Stockpick Gratis" section, grab its whole text,
// then globally match the fixed pattern
//   TICKER NAME PCT% YYYY-MM-DD HH:MM(:SS) Buy|Sell|Hold PRICE
function extractInPage() {
  const results = [];

  // Find the "Stockpick Gratis" heading
  const candidates = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,a');
  let header = null;
  for (const el of candidates) {
    const t = (el.textContent || '').trim();
    if (/^stockpick\s*gratis$/i.test(t) || /stockpick\s*gratis/i.test(t)) {
      header = el;
      break;
    }
  }
  if (!header) return results;

  // Walk up to a container whose text holds multiple timestamp/action pairs.
  // This usually lands us on the section wrapper containing the whole list.
  const tsActionRe =
    /20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:Buy|Sell|Hold|BUY|SELL|HOLD)/g;

  let container = header;
  let best = header;
  let bestCount = 0;
  for (let i = 0; i < 10 && container && container.parentElement; i++) {
    container = container.parentElement;
    const txt = container.textContent || '';
    const matches = txt.match(tsActionRe);
    const count = matches ? matches.length : 0;
    if (count > bestCount) {
      bestCount = count;
      best = container;
    }
    // Stop climbing once we have the body (no point going higher)
    if (container === document.body) break;
  }

  if (bestCount === 0) return results;

  const text = (best.textContent || '').replace(/\s+/g, ' ').trim();

  // Master row pattern. Name is non-greedy so it stops at the nearest percent.
  const rowRe =
    /\b([A-Z]{3,5})\s+([^%]{1,80}?)\s+(-?\d+(?:[.,]\d+)?\s*%)\s+(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+(Buy|Sell|Hold|BUY|SELL|HOLD)\s+([0-9][0-9.,]*)/g;

  const seen = new Set();
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const pick = {
      ticker: m[1],
      name: m[2].trim().replace(/\s+/g, ' '),
      change: m[3].replace(/\s+/g, ''),
      pickTime: m[4],
      action: m[5].charAt(0).toUpperCase() + m[5].slice(1).toLowerCase(),
      price: m[6],
    };
    const key = `${pick.ticker}|${pick.pickTime}|${pick.change}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(pick);
  }

  return results;
}

export async function fetchPicks() {
  if (!page) await launch();

  try {
    // Reload the page to get fresh data
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Wait for the Stockpick Gratis heading to be present
    await page
      .waitForFunction(
        () => {
          const all = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span');
          for (const el of all) {
            if (/stockpick\s*gratis/i.test(el.textContent || '')) return true;
          }
          return false;
        },
        null,
        { timeout: 30_000 },
      )
      .catch(() => {
        // proceed anyway; maybe content is there without matching our selectors
      });

    // Give the client-side app a tick to populate rows
    await page.waitForTimeout(1500);

    const picks = await page.evaluate(extractInPage);
    return picks;
  } catch (err) {
    logger.warn({ err: err.message }, 'scrape failed, restarting browser');
    await closeScraper();
    await launch();
    return [];
  }
}
