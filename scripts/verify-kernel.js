#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Use process.cwd() to get the actual project root, not script directory
const projectRoot = process.cwd();
const kernelPath = path.join(projectRoot, 'dist-electron', 'miner-kernel.js');

console.log('[Verify] Checking for miner-kernel.js...');
console.log('[Verify] Project root:', projectRoot);
console.log('[Verify] Looking for:', kernelPath);

if (!fs.existsSync(kernelPath)) {
  console.error('❌ ERROR: miner-kernel.js not found at', kernelPath);
  console.error('[Verify] Contents of dist-electron/:');
  try {
    const distElectronDir = path.join(projectRoot, 'dist-electron');
    if (fs.existsSync(distElectronDir)) {
      const files = fs.readdirSync(distElectronDir);
      files.forEach(f => console.error('  -', f));
    } else {
      console.error('  dist-electron/ directory does not exist!');
    }
  } catch (e) {
    console.error('  Could not list directory:', e.message);
  }
  process.exit(1);
}

const size = fs.statSync(kernelPath).size;
console.log(`✅ miner-kernel.js verified: ${size} bytes`);
process.exit(0);
