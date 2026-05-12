import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { getStatus, getQRDataUrl } from './whatsapp.js';
import { size as storeSize } from './store.js';

export function startHttp() {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    if (url === '/health' || url === '/healthz') {
      const status = getStatus();
      res.writeHead(status.ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...status, seen: storeSize() }));
      return;
    }

    if (url === '/qr') {
      const dataUrl = getQRDataUrl();
      const status = getStatus();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (status.ready) {
        res.end(`<html><body style="font-family:sans-serif;padding:2rem">
          <h2>WhatsApp connected ✅</h2>
          <p>Sender: <code>${status.sender}</code> · Target: <code>${status.target}</code></p>
        </body></html>`);
        return;
      }
      if (!dataUrl) {
        res.end(`<html><body style="font-family:sans-serif;padding:2rem">
          <h2>Waiting for QR...</h2>
          <p>Refresh in a few seconds.</p>
          <script>setTimeout(()=>location.reload(), 3000)</script>
        </body></html>`);
        return;
      }
      res.end(`<html><body style="font-family:sans-serif;padding:2rem;text-align:center">
        <h2>Scan with WhatsApp (number <code>${status.sender}</code>)</h2>
        <p>WhatsApp → Settings → Linked devices → Link a device</p>
        <img src="${dataUrl}" alt="QR" style="width:320px;height:320px"/>
        <p style="color:#888">Auto-refresh every 5s</p>
        <script>setTimeout(()=>location.reload(), 5000)</script>
      </body></html>`);
      return;
    }

    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('FITStock WA Alert. Try /qr or /health.');
  });

  server.listen(config.httpPort, () => {
    logger.info({ port: config.httpPort }, 'HTTP server listening');
  });
  return server;
}
