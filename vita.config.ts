import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut: The plugin automatically builds this to dist-electron/main.js
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Vital: Keep C++ and Node modules external
              external: [
                'electron', 
                'path', 'fs', 'os', 'worker_threads', 'crypto',
                'tiny-secp256k1', 'keccak', 'bip39', 'systeminformation'
              ],
            },
          },
          plugins: [{
            name: 'copy-miner-kernel',
            closeBundle() {
              const src = path.join(process.cwd(), 'electron/miner-kernel.js');
              const dest = path.join(process.cwd(), 'dist-electron/miner-kernel.js');
              
              if (fs.existsSync(src)) {
                if (!fs.existsSync(path.dirname(dest))) {
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                }
                fs.copyFileSync(src, dest);
                console.log('[Build] Copied miner-kernel.js');
              }
            }
          }]
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
            build: {
                outDir: 'dist-electron',
                rollupOptions: {
                    external: ['electron']
                }
            }
        }
      },
      renderer: {},
    }),
  ],
})