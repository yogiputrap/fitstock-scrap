import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';

// Simple JSON-backed dedup set. Key = stable hash of a pick.
// We keep the last N keys to avoid unbounded growth.
const MAX_KEYS = 2000;

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function load() {
  try {
    const raw = fs.readFileSync(paths.stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.seen)) return new Map(parsed.seen);
  } catch {
    // first run or corrupt file; start fresh
  }
  return new Map();
}

function persist(map) {
  ensureDir(paths.stateFile);
  const entries = [...map.entries()].slice(-MAX_KEYS);
  const tmp = paths.stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ seen: entries }, null, 0));
  fs.renameSync(tmp, paths.stateFile);
}

const seen = load();

export function has(key) {
  return seen.has(key);
}

export function add(key, meta = {}) {
  seen.set(key, { ts: Date.now(), ...meta });
  persist(seen);
}

export function size() {
  return seen.size;
}

export function keyOf(pick) {
  // ticker + pick timestamp + change uniquely identifies a broadcast entry.
  // Some symbols appear multiple times at the same timestamp with different
  // momentum scores - we treat each as its own pick.
  return `${pick.ticker}|${pick.pickTime}|${pick.change}`;
}
