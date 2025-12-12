const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function timestamp() {
  const d = new Date();
  const ts = d.toISOString().replace(/[:.]/g, '-');
  return ts;
}

const out = `release-build-${timestamp()}`;
console.log('Building to', out);
try {
  execSync('npx tsc', { stdio: 'inherit' });
  execSync('npx tsc -p tsconfig.electron.json', { stdio: 'inherit' });
  execSync('npx vite build', { stdio: 'inherit' });
  // Ensure miner-kernel.js is copied into dist-electron so electron-builder
  // can unpack it (workers require a real filesystem path).
  try {
    const srcKernel = path.join(__dirname, '..', 'electron', 'miner-kernel.js');
    const destDir = path.join(__dirname, '..', 'dist-electron');
    const destKernel = path.join(destDir, 'miner-kernel.js');
    if (fs.existsSync(srcKernel)) {
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcKernel, destKernel);
      console.log('Copied miner-kernel.js to dist-electron');
    } else {
      console.warn('Source miner-kernel.js not found, skipping copy');
    }
  } catch (copyErr) {
    console.warn('Failed to copy miner-kernel.js:', copyErr && copyErr.message);
  }
  execSync(`npx electron-builder --config.directories.output=${out}`, { stdio: 'inherit' });
  console.log('Built to', out);
} catch (e) {
  console.error('Build failed', e && e.message);
  process.exit(1);
}
