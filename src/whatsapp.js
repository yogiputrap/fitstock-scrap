// WhatsApp client using whatsapp-web.js (runs real WhatsApp Web inside
// Puppeteer-controlled Chromium). This avoids the "waiting for this message"
// decryption issues that plague custom Signal Protocol implementations,
// because the actual WA Web client handles all encryption identically to a
// human user on a browser.

import pkg from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'node:fs';
import { config, paths } from './config.js';
import { logger } from './logger.js';

const { Client, LocalAuth } = pkg;

let client = null;
let currentQR = null;
let currentQRDataUrl = null;
let isReady = false;
let initializing = false;

export function getStatus() {
  return {
    ready: isReady,
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

async function start() {
  if (initializing) return;
  initializing = true;

  try {
    fs.mkdirSync(paths.waAuthDir, { recursive: true });

    client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'fitstock-wa',
        dataPath: paths.waAuthDir,
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-features=site-per-process',
        ],
      },
    });

    client.on('qr', async (qr) => {
      currentQR = qr;
      try {
        currentQRDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      } catch (e) {
        logger.warn({ err: e.message }, 'failed to render QR');
      }
      logger.info(
        `WhatsApp QR ready. Open http://<host>:${config.httpPort}/qr and scan with the sender device (${config.waSender}).`,
      );
    });

    client.on('authenticated', () => {
      logger.info('WhatsApp authenticated, loading WA Web (this may take ~30s)');
      currentQR = null;
      currentQRDataUrl = null;
    });

    client.on('auth_failure', (msg) => {
      logger.error({ msg }, 'WhatsApp auth failure');
      isReady = false;
    });

    client.on('ready', () => {
      isReady = true;
      currentQR = null;
      currentQRDataUrl = null;
      const me = client.info?.wid?.user;
      logger.info({ me }, 'WhatsApp client ready');
      if (me && me !== config.waSender) {
        logger.warn(
          { expected: config.waSender, got: me },
          'Connected WA number does not match WA_SENDER',
        );
      }
    });

    client.on('change_state', (state) => {
      logger.debug({ state }, 'WhatsApp state change');
    });

    client.on('disconnected', async (reason) => {
      isReady = false;
      logger.warn({ reason }, 'WhatsApp disconnected, reinitializing');
      try {
        await client.destroy();
      } catch {
        // ignore
      }
      client = null;
      initializing = false;
      setTimeout(() => start(), 3000);
    });

    await client.initialize();
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'failed to init WA client');
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
    throw new Error('WhatsApp not ready');
  }
  const chatId = toChatId(config.waTarget);

  // Verify the target is registered on WhatsApp
  const registered = await client.isRegisteredUser(chatId);
  if (!registered) {
    throw new Error(`Target number ${config.waTarget} is not on WhatsApp`);
  }

  return client.sendMessage(chatId, text);
}
