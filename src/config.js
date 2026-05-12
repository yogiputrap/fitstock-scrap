import 'dotenv/config';
import path from 'node:path';

const required = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === null || v === '') {
    throw new Error(`Missing env var: ${name}`);
  }
  return v;
};

export const config = {
  targetUrl: required('TARGET_URL', 'https://fitstock.id/#sec-spil'),
  pollIntervalMs: Number(required('POLL_INTERVAL_MS', '10000')),
  waSender: required('WA_SENDER'),
  waTarget: required('WA_TARGET'),
  httpPort: Number(required('HTTP_PORT', '3000')),
  notifyOnStartup: String(process.env.NOTIFY_ON_STARTUP ?? 'false').toLowerCase() === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
};

export const paths = {
  stateFile: path.join(config.dataDir, 'state.json'),
  waAuthDir: path.join(config.dataDir, 'wa-auth'),
};
