#!/usr/bin/env node
// Remote worker that connects to the coordinator and runs miner-kernel as worker threads.
const WebSocket = require('ws');
const { Worker } = require('worker_threads');
const path = require('path');

const coordinatorUrl = process.env.COORD_URL || `ws://${process.env.COORD_HOST || '127.0.0.1'}:${process.env.COORD_PORT || 8080}`;
console.log('Connecting to coordinator at', coordinatorUrl);

const ws = new WebSocket(coordinatorUrl);

let kernelPathCandidate = path.join(__dirname, '..', 'electron', 'miner-kernel.js');
try { if (!require('fs').existsSync(kernelPathCandidate)) kernelPathCandidate = path.join(process.cwd(), 'dist-electron', 'miner-kernel.js'); } catch (e) {}

ws.on('open', () => {
  console.log('Connected to coordinator');
});

ws.on('message', (m) => {
  try {
    const msg = JSON.parse(m.toString());
    if (msg.action === 'START' && msg.config) {
      startMining(msg.config);
    } else if (msg.action === 'STOP') {
      stopMining();
    }
  } catch (e) { console.warn('Bad coordinator message', e); }
});

ws.on('close', () => { console.log('Coordinator disconnected'); process.exit(0); });
ws.on('error', (e) => { console.warn('Coordinator error', e && e.message); });

let workers = [];
function startMining(cfg) {
  const threads = cfg.threads || Math.max(1, require('os').cpus().length - 1);
  console.log('Starting', threads, 'worker threads using kernel', kernelPathCandidate);
  for (let i = 0; i < threads; i++) {
    try {
      const w = new Worker(kernelPathCandidate, { workerData: { threadId: i, config: cfg } });
      w.on('message', (msg) => { try { ws.send(JSON.stringify(msg)); } catch (e) {} });
      w.on('error', (e) => { try { ws.send(JSON.stringify({ type: 'LOG', payload: 'Worker error: ' + e.message })); } catch (e) {} });
      w.on('exit', (c) => { try { ws.send(JSON.stringify({ type: 'LOG', payload: 'Worker exit ' + c })); } catch (e) {} });
      workers.push(w);
    } catch (e) { console.error('Failed to spawn worker', e && e.message); }
  }
}

function stopMining() {
  for (const w of workers) try { w.terminate(); } catch (e) {}
  workers = [];
}

// Small CLI to interact
if (require.main === module) {
  const repl = require('repl');
  const r = repl.start({ prompt: 'worker> ' });
  r.context.start = (cfg) => startMining(cfg || {});
  r.context.stop = stopMining;
}
