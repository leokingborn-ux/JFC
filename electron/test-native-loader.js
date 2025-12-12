const { parentPort } = require('worker_threads');

try {
  const ecc = require('tiny-secp256k1');
  const createKeccakHash = require('keccak');
  parentPort.postMessage({ ok: true, message: 'native-requires-success' });
} catch (e) {
  parentPort.postMessage({ ok: false, message: e && e.message ? e.message : String(e), stack: e && e.stack });
}

// ensure worker exits
setTimeout(() => process.exit(0), 50);
