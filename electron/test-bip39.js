const crypto = require('crypto');
const bip39 = require('bip39');

console.log('Testing bip39...');
try {
  for (let i = 0; i < 50; i++) {
    const e16 = crypto.randomBytes(16);
    const m12 = bip39.entropyToMnemonic(e16.toString('hex'));
    
    const e32 = crypto.randomBytes(32);
    const m24 = bip39.entropyToMnemonic(e32.toString('hex'));
  }
  console.log('SUCCESS: All bip39 calls worked');
} catch (e) {
  console.error('FAILED:', e && e.message);
  process.exit(1);
}
