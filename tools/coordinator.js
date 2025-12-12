#!/usr/bin/env node
// Lightweight WebSocket coordinator to accept remote workers and forward mining configs
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const WS_PORT = process.env.COORD_PORT || 8080;
const MONITOR_PORT = process.env.MONITOR_PORT || 8081;
const monitorFile = path.join(__dirname, 'monitor.html');

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`Coordinator listening on ws://0.0.0.0:${WS_PORT}`);

// In-memory registries
const workers = new Map();
const foundEvents = [];
const MAX_FOUND = 200;

function addFound(e) {
  foundEvents.unshift(e);
  if (foundEvents.length > MAX_FOUND) foundEvents.pop();
}

wss.on('connection', (ws, req) => {
  const id = `${Date.now()}-${Math.floor(Math.random()*10000)}`;
  workers.set(id, { ws, address: req.socket.remoteAddress });
  console.log('Worker connected', id, req.socket.remoteAddress);

  ws.on('message', (m) => {
    try {
      const msg = JSON.parse(m.toString());
      if (msg.type === 'FOUND') {
        const ev = { id, payload: msg.payload, ts: Date.now() };
        addFound(ev);
        console.log('[FOUND]', msg.payload.address, 'from', id);
      } else if (msg.type === 'LOG') {
        console.log('[WORKER LOG]', id, msg.payload);
      } else if (msg.type === 'CHECKPOINT') {
        console.log('[CHECKPOINT] from', id);
      }
    } catch (err) { console.warn('Bad message', err); }
  });

  ws.on('close', () => { workers.delete(id); console.log('Worker disconnected', id); });
  ws.on('error', (e) => { console.warn('Worker error', id, e && e.message); });
});

// HTTP monitor server: /status returns JSON, root serves monitor.html
const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === '/status') {
    const list = Array.from(workers.entries()).map(([id, info]) => ({ id, address: info.address }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ workers: list, found: foundEvents.slice(0, 100) }));
    return;
  }

  if (u.pathname === '/' || u.pathname === '/monitor') {
    try {
      const html = fs.readFileSync(monitorFile, 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    } catch (e) {
      res.statusCode = 500; res.end('Monitor not available');
    }
    return;
  }

  res.statusCode = 404; res.end('Not found');
});

server.listen(MONITOR_PORT, '0.0.0.0', () => console.log(`Monitor UI available at http://0.0.0.0:${MONITOR_PORT}/monitor`));

// Expose a tiny CLI to list workers and broadcast commands
if (require.main === module) {
  const repl = require('repl');
  const r = repl.start({ prompt: 'coord> ' });
  r.context.list = () => Array.from(workers.keys());
  r.context.broadcast = (obj) => {
    const s = JSON.stringify(obj);
    for (const entry of workers.values()) {
      try { entry.ws.send(s); } catch (e) { /* ignore */ }
    }
    return true;
  };
}
