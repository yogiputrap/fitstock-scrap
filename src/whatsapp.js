import pkg from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { config, paths } from './config.js';
import { logger } from './logger.js';

const { Client, LocalAuth } = pkg;

let client = null;
let currentQR = null;
let currentQRDataUrl = null;
let isReady = false;
let initializing = false;
let waState = 'starting'; // starting | qr | authenticated | ready | failed

export function getStatus() {
  return {
    ready: isReady,
    state: waState,
    hasQR: Boolean(currentQR),
    sender: config.waSender,
    target: config.waTarget,
  };
}

export function getQRDataUrl() {
  return currentQRDataUrl;
}

function toChatId(numberDigits) {
  return `${numberDigits}@c.us`;
}

// Reuse the Chromium that ships with the Playwright Docker image.
// This avoids downloading a second browser and sidesteps permission issues
// with puppeteer's own cache directory.
function findChromiumPath() {
  // Prefer full Chromium (not headless-shell) for whatsapp-web.js
  const candidates = [
    // Playwright image layout: /ms-playwright/chromium-XXXX/chrome-linux/chrome
    'find /ms-playwright -name "chrome" -not -name "chrome-headless-shell" -type f 2>/dev/null | head -1',
    // Fallback: system chrome
    'which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null || which chromium 2>/dev/null',
  ];
  for (const cmd of candidates) {
    try {
      const p = execSync(cmd).toString().trim();
      if (p) {
        logger.info({ path: p }, 'using Chromium');
        return p;
      }
    } catch {
      // try next
    }
  }
  logger.warn('no Chromium found via search, letting puppeteer use its default');
  return undefined;
}

async function start() {
  if (initializing) return;
  initializing = true;
  waState = 'starting';

  try {
    fs.mkdirSync(paths.waAuthDir, { recursive: true });

    const executablePath = findChromiumPath();

    client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'fitstock-wa',
        dataPath: paths.waAuthDir,
      }),
      puppeteer: {
        headless: true,
        executablePath,          // use image's Chromium; undefined = puppeteer default
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--disable-extensions',
        ],
      },
    });

    client.on('qr', async (qr) => {
      waState = 'qr';
      currentQR = qr;
      try {
        currentQRDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      } catch (e) {
        logger.warn({ err: e.message }, 'failed to render QR');
      }
      logger.info(
        `WhatsApp QR ready — open http://<host>:${config.httpPort}/qr and scan with ${config.waSender}`,
      );
    });

    client.on('authenticated', () => {
      waState = 'authenticated';
      currentQR = null;
      currentQRDataUrl = null;
      logger.info('WhatsApp authenticated — loading WA Web (~30s)');
    });

    client.on('auth_failure', (msg) => {
      waState = 'failed';
      logger.error({ msg }, 'WhatsApp auth failure — delete /data/wa-auth and restart');
      isReady = false;
    });

    client.on('ready', () => {
      waState = 'ready';
      isReady = true;
      currentQR = null;
      currentQRDataUrl = null;
      const me = client.info?.wid?.user;
      logger.info({ me }, '✅ WhatsApp client ready — messages can now be sent');
      if (me && me !== config.waSender) {
        logger.warn({ expected: config.waSender, got: me }, 'WA number mismatch');
      }
    });

    client.on('change_state', (state) => {
      logger.info({ state }, 'WhatsApp state change');
    });

    client.on('disconnected', async (reason) => {
      isReady = false;
      waState = 'starting';
      logger.warn({ reason }, 'WhatsApp disconnected — reinitializing in 3s');
      try { await client.destroy(); } catch { /* ignore */ }
      client = null;
      initializing = false;
      setTimeout(() => start(), 3000);
    });

    logger.info('WhatsApp client initializing (browser launching)...');
    await client.initialize();
    logger.info('WhatsApp client.initialize() resolved');

  } catch (err) {
    waState = 'failed';
    logger.error({ err: err.message, stack: err.stack }, 'failed to init WA client — retrying in 5s');
    client = null;
    initializing = false;
    setTimeout(() => start(), 5000);
    return;
  }

  initializing = false;
}

export async function initWhatsApp() {
  await start();
}

export async function sendText(text) {
  if (!isReady || !client) {
    throw new Error(`WhatsApp not ready (state: ${waState})`);
  }
  const chatId = toChatId(config.waTarget);
  return client.sendMessage(chatId, text);
}
