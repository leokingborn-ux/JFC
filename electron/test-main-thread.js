const crypto = require('crypto');
const ecc = require('tiny-secp256k1');
const { keccak256: jsKeccak } = require('js-sha3');

function privateToAddress(privateKey) {
  const publicKey = ecc.pointFromScalar(privateKey, false);
  if (!publicKey) throw new Error('pointFromScalar returned null');
  
  // Convert Uint8Array to Buffer if needed
  const publicKeyBuf = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey);
  
  // Extract the 64-byte uncompressed key (skip first byte which is the format prefix)
  const pub = Buffer.alloc(64);
  publicKeyBuf.copy(pub, 0, 1, 65);
  
  const hash = Buffer.from(jsKeccak.digest(pub), 'hex');
  return hash.subarray(-20);
}

console.log('Testing crypto in main thread...');
try {
  for (let i = 0; i < 100; i++) {
    const entropy = crypto.randomBytes(32);
    const priv = entropy;
    if (!ecc.isPrivate(priv)) continue;
    const addr = privateToAddress(priv);
    if (!addr || addr.length !== 20) throw new Error('invalid addr');
    if (i % 20 === 0) console.log(`✓ ${i} iterations`);
  }
  console.log('SUCCESS: All 100 iterations completed');
  process.exit(0);
} catch (e) {
  console.error('FAILED:', e && e.message);
  process.exit(1);
}
