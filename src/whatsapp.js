import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'node:fs';
import { config, paths } from './config.js';
import { logger } from './logger.js';

let sock = null;
let currentQR = null;        // raw QR string
let currentQRDataUrl = null; // PNG data URL for the web view
let isReady = false;
let connecting = false;

const baileysLogger = pino({ level: 'warn' });
const msgRetryCounterCache = new NodeCache();
// Tiny LRU of outgoing messages so Baileys can answer retry-decryption requests
// from the recipient. Without this, messages stay stuck on "waiting for this message".
const sentMessageCache = new Map();
const SENT_CACHE_MAX = 200;

function jidFor(numberDigits) {
  return `${numberDigits}@s.whatsapp.net`;
}

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

async function startSocket() {
  if (connecting) return;
  connecting = true;

  try {
    fs.mkdirSync(paths.waAuthDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(paths.waAuthDir);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        // Cache signal keys so Signal Protocol sessions can resolve quickly;
        // required for reliable message decryption on the receiver side.
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      printQRInTerminal: false,
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      msgRetryCounterCache,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      // When a recipient can't decrypt, WA asks the sender to re-send the
      // plaintext. Return the original message body from our small cache.
      getMessage: async (key) => {
        const cached = sentMessageCache.get(key?.id);
        if (cached) return cached;
        return { conversation: '' };
      },
    });

    sock.ev.on('creds.update', saveCreds);

    // Persist our own outgoing messages for retry-decryption
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages) {
        if (m?.key?.fromMe && m.message && m.key.id) {
          if (sentMessageCache.size >= SENT_CACHE_MAX) {
            // drop oldest
            const first = sentMessageCache.keys().next().value;
            if (first) sentMessageCache.delete(first);
          }
          sentMessageCache.set(m.key.id, m.message);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        try {
          currentQRDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        } catch (e) {
          logger.warn({ err: e.message }, 'failed to render QR');
        }
        logger.info(
          `WhatsApp QR ready. Open http://localhost:${config.httpPort}/qr ` +
            `and scan with the sender device (${config.waSender}).`,
        );
      }

      if (connection === 'open') {
        isReady = true;
        currentQR = null;
        currentQRDataUrl = null;
        const me = sock.user?.id?.split(':')[0]?.split('@')[0];
        logger.info({ me }, 'WhatsApp connected');

        if (me && !me.endsWith(config.waSender)) {
          logger.warn(
            { expected: config.waSender, got: me },
            'Connected WA number does not match WA_SENDER. Check .env.',
          );
        }
      }

      if (connection === 'close') {
        isReady = false;
        const statusCode = new Boom(lastDisconnect?.error).output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        logger.warn({ statusCode, loggedOut }, 'WhatsApp disconnected');

        if (loggedOut) {
          // auth is invalid - wipe so the next connect shows a fresh QR
          try {
            fs.rmSync(paths.waAuthDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
        connecting = false;
        setTimeout(() => startSocket(), 2000);
      }
    });
  } catch (err) {
    logger.error({ err: err.message }, 'failed to start WhatsApp socket');
    connecting = false;
    setTimeout(() => startSocket(), 5000);
    return;
  }

  connecting = false;
}

export async function initWhatsApp() {
  await startSocket();
}

export async function sendText(text) {
  if (!isReady || !sock) {
    throw new Error('WhatsApp not ready');
  }
  const jid = jidFor(config.waTarget);

  // Verify number is registered on WhatsApp (otherwise messages never deliver)
  try {
    const [info] = await sock.onWhatsApp(config.waTarget);
    if (!info?.exists) {
      throw new Error(`Target number ${config.waTarget} is not on WhatsApp`);
    }
  } catch (err) {
    // Non-fatal: onWhatsApp can occasionally fail even for valid numbers.
    // Continue attempting send; log the warning.
    logger.warn({ err: err.message }, 'onWhatsApp check failed, sending anyway');
  }

  const result = await sock.sendMessage(jid, { text });
  // Cache immediately so retry-decryption requests can be served without
  // waiting for the messages.upsert event.
  if (result?.key?.id && result.message) {
    if (sentMessageCache.size >= SENT_CACHE_MAX) {
      const first = sentMessageCache.keys().next().value;
      if (first) sentMessageCache.delete(first);
    }
    sentMessageCache.set(result.key.id, result.message);
  }
  return result;
}
