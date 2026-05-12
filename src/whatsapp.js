import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
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

const baileysLogger = pino({ level: 'silent' });

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
      auth: state,
      printQRInTerminal: false,
      logger: baileysLogger,
      browser: ['FITStock Alert', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

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
  await sock.sendMessage(jid, { text });
}
