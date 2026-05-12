// Shared runtime state — imported by both index.js and server.js
// to avoid circular dependencies.
export const tickStats = {
  count: 0,
  lastTickAt: null,
  lastPickCount: 0,
  lastNewCount: 0,
  lastSentCount: 0,
};
