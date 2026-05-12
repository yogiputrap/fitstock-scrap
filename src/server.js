import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { getStatus, getQRDataUrl, sendText } from './whatsapp.js';
import { size as storeSize } from './store.js';

export function startHttp() {
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    if (url === '/health' || url === '/healthz') {
      const status = getStatus();
      res.writeHead(status.ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...status, seen: storeSize() }));
      return;
    }

    if (url === '/status') {
      const status = getStatus();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;padding:2rem">
        <h2>FITStock WA Alert — Status</h2>
        <pre>${JSON.stringify({ ...status, seen: storeSize() }, null, 2)}</pre>
        <p>States: starting → qr (scan QR) → authenticated → ready ✅</p>
        <p><a href="/qr">QR Page</a> | <a href="/health">Health JSON</a></p>
        <script>setTimeout(()=>location.reload(), 4000)</script>
      </body></html>`);
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
          <h2>Waiting for QR / loading WhatsApp Web...</h2>
          <p>After scanning, WA Web takes ~30 seconds to fully load. Refresh this page.</p>
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

    if (url === '/send-test') {
      const status = getStatus();
      if (!status.ready) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end(`NOT READY — current state: "${status.state}"\n\nCheck /status for details.\nStates: starting → qr → authenticated → ready\nIf stuck on "authenticated", wait ~30s for WA Web to load.`);
        return;
      }
      try {
        await sendText('✅ *FITStock WA Alert — test message*\nKoneksi WhatsApp berjalan normal.');
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('OK: test message sent');
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`ERROR: ${err.message}`);
      }
      return;
    }

    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('FITStock WA Alert. Try /qr, /health, or /send-test.');
  });

  server.listen(config.httpPort, () => {
    logger.info({ port: config.httpPort }, 'HTTP server listening');
  });
  return server;
}
