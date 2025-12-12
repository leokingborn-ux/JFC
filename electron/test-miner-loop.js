const { parentPort } = require('worker_threads');
const crypto = require('crypto');

try {
  const ecc = require('tiny-secp256k1');
  const { keccak256: jsKeccak } = require('js-sha3');
} catch (e) {
  parentPort.postMessage({ ok: false, msg: 'require failed', err: e && e.message });
  setTimeout(() => process.exit(1), 50);
}

const ecc = require('tiny-secp256k1');
const { keccak256: jsKeccak } = require('js-sha3');

function privateToAddress(privateKey) {
  try {
    const publicKey = ecc.pointFromScalar(privateKey, false);
    if (!publicKey) throw new Error('pointFromScalar returned null');
    
    // tiny-secp256k1 returns Uint8Array; must convert to Buffer for .copy()
    const pub = Buffer.alloc(64);
    const pubBuf = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey);
    pubBuf.copy(pub, 0, 1, 65);
    
    const hash = Buffer.from(jsKeccak.digest(pub), 'hex');
    return hash.subarray(-20);
  } catch (e) {
    throw new Error(`privateToAddress: ${e && e.message}`);
  }
}

try {
  const ITER = 100;
  let successes = 0;
  for (let i = 0; i < ITER; i++) {
    try {
      const entropy = crypto.randomBytes(32);
      const priv = entropy;
      if (!ecc.isPrivate(priv)) continue;
      const addr = privateToAddress(priv);
      if (addr && addr.length === 20) successes++;
    } catch (e) {
      parentPort.postMessage({ ok: false, iter: i, err: e && e.message });
      setTimeout(() => process.exit(1), 50);
      return;
    }
  }
  parentPort.postMessage({ ok: true, iterations: ITER, successes });
} catch (e) {
  parentPort.postMessage({ ok: false, err: e && e.message, stack: e && e.stack });
}
setTimeout(() => process.exit(0), 50);
