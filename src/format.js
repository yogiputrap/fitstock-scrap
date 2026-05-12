export function formatPickMessage(pick) {
  const lines = [
    '🚨 *FITStock — Stockpick Gratis*',
    '',
    `*${pick.ticker}*${pick.name ? ` — ${pick.name}` : ''}`,
    pick.change ? `Change: ${pick.change}` : null,
    pick.action && pick.price ? `Signal: *${pick.action}* @ *${pick.price}*` : null,
    pick.pickTime ? `Time: ${pick.pickTime} WIB` : null,
    '',
    'Sumber: https://fitstock.id/#sec-spil',
  ].filter(Boolean);
  return lines.join('\n');
}
