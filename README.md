# Artemis 2.0 - Neural Engine for Cryptographic Address Mining

High-performance Electron + React desktop application for generating entropy, deriving cryptocurrency addresses, and learning from pattern correlations via a neural "brain" to optimize proximity to target addresses.

## Features

### 1. **Key Generation (BIP-39 Standard)**
- Locally generate cryptographically secure mnemonics, private keys, and Ethereum addresses
- No external APIs or network calls — all computation on-device
- Configurable entropy: 12-word (128-bit) or 24-word (256-bit) seed phrases
- Entropy scoring and validation

### 2. **Address Mining with Neural Learning**
- Brute-force mnemonic generation against a target address
- **Neural Engine** learns correlations between:
  - **N-Gram Patterns**: Mnemonic word sequences correlated with address byte patterns
  - **Entropy Bias Adaptation**: Learns whether 12-word or 24-word seeds are more effective (togglable via UI)
  - **Seed-Bit Statistics**: Analyzes which entropy bit regions correlate with improved address bytes
- Tracks **Hamming distance** (byte-level proximity to target); displays best distance in real-time
- Persists session state so interrupted mining resumes from the last checkpoint

### 3. **Data Persistence**
- **Dexie IndexedDB**: Stores generated keys and public addresses for learning and lookup
- **Session Checkpoints**: Binary state file (`session_<target>.dat`) written every 60 seconds containing brain state, entropy bias, iteration count, and RNG seed
- **Resume on Crash**: App recovers state on next launch; no learning loss

### 4. **Hardware Optimization (Adaptive Power Modes)**
- **Balanced Mode** (~75% CPU): Reserves computational capacity for OS/UI responsiveness
  - Automatically detects available CPU cores and reserves ~25% for system tasks
  - Ideal for interactive use on multi-core machines
- **Performance Mode** (100% CPU): Unleash full computational power
  - Uses all available logical cores
  - Maximum mining throughput; may impact UI responsiveness
- **Dynamic Mode Switching**: Switch between balanced/performance on-the-fly without stopping the miner
  - Hardware detection: CPU model, core count, available RAM
  - User-controllable via toggle in Miner Dashboard
  - Respawns worker threads with adjusted thread count when mode changes

### 5. **Static Hardware Optimization**
- **3-Thread Mining Default**: Automatically uses 3 cores, leaving 1 core free for OS/UI (prevents UI freezing)
- **SSE4.2 Support**: Optimized for i5-760 and equivalent CPUs (supports SSE4.1/SSE4.2, not AVX2)
- **Zero-Copy Memory Model**: Mining loop allocates on stack only; no heap fragmentation
- **Circular Buffer Stats**: UI snapshots performance every 200ms, decoupled from mining speed

### 6. **Hardware Monitoring**
- Real-time CPU load, RAM usage, and CPU temperature display
- Sidecar monitoring via `systeminformation` (reads every 2 seconds, <0.1% CPU overhead)

---

## Quick Start

### Prerequisites
- Node.js 16+ (LTS recommended)
- Windows 10/11 (or Windows 7+ with .NET Framework for native crypto bindings)
- 16 GB RAM recommended (app uses ~2-3GB during active mining)

### Development

```bash
# Install dependencies
npm install

# Run in dev mode (Vite hot reload + Electron auto-restart)
npm run dev

# In another terminal, start Electron
VITE_DEV_SERVER_URL=http://localhost:5174 npx electron .
```

### Production Build

```bash
# Windows NSIS installer
npm run build

# Linux .deb package (requires Linux/WSL/Docker)
npm run build:linux
```

Outputs to `release-build/`:
- **Windows**: `Artemis Native Setup 2.0.0.exe`
- **Linux**: `artemis-native_2.0.0_amd64.deb`

### Automated Builds (GitHub Actions)

Artemis uses GitHub Actions for cross-platform CI/CD:

**Windows Build** (automatic on push to `main`):
- Runs on `windows-latest` runner
- Produces NSIS installer
- Uploads to artifacts

**Linux Build** (automatic on push to `main`):
- Runs on `ubuntu-22.04` runner
- Produces `.deb` package
- Uploads to artifacts

To download artifacts:
1. Go to repo → **Actions** tab
2. Click the latest workflow run
3. Download `artemis-linux-ubuntu-22.04` (contains `.deb`)

**Run Locally:**
```bash
# Run the packaged Windows installer
.\release-build\Artemis Native Setup 2.0.0.exe

# Test the Linux .deb on Ubuntu 22.04
sudo dpkg -i release-build/artemis-native_2.0.0_amd64.deb
artemis-native
```

---

## Architecture

### Three-Layer Stack
1. **Renderer (React)**: `src/App.tsx`, `src/components/`
   - Dashboard: Mining UI, target configuration, neural engine visualization
   - Generator: BIP-39 key generation, entropy scoring
   - ErrorBoundary + StartupGate: Graceful error handling and preload detection

2. **Main Process (Electron)**: `electron/main.ts`
   - Window lifecycle, IPC handler registration
   - Worker thread spawning and management
   - Hardware monitoring sidecar

3. **Worker Threads (Compute)**: `electron/miner-kernel.js`
   - Entropy generation, mnemonic derivation (via `bip39`)
   - Private key → address derivation (via `tiny-secp256k1` + `keccak`)
   - N-gram correlation tracking and brain updates
   - Periodic checkpoint writes to `session_<target>.dat`

### IPC Message Flow
- **UI → Main**: `window.electron.startMining(config)` → `START_MINING` IPC event
- **Main → Renderer**: `webContents.send('MINER_UPDATE', msg)` receives `STATS`, `LOG`, `LEARNING`, `SAMPLE`, `FOUND`, `CHECKPOINT` messages
- **Worker → Main → Renderer**: Worker thread emits messages, main forwards to renderer

### Data Storage

#### IndexedDB (Dexie)
- **Tables**:
  - `keys`: Generated keys + mnemonics (only if `storeAll` is true, default)
  - `stats`: Mining statistics
  - `sessions`: `MiningSession` metadata (entropy bias, rewards, best distance)
- **Location**: Browser IndexedDB (persists across app restarts)
- **Schema Version**: 2 (auto-migrates on version increment)

#### Session Checkpoint (`session_<target>.dat`)
- **Format**: JSON-serialized binary file
- **Location**: The folder the app is run from by default (`process.cwd()`).
  You can override this with the `ARTEMIS_DATA_DIR` environment variable to point to a specific directory.
- **Frequency**: Every 60 seconds during mining
- **Contents**:
  - Target address
  - Entropy bias and rewards (12-word vs 24-word)
  - Best Hamming distance found
  - Iteration count
  - Correlation matrix (N-gram → address patterns)

#### Key Export
- **Private keys are only exported on explicit FOUND events** (full match found)
- `storeAll` default is **true**: all generated keys are persisted to IndexedDB for learning
- No keys are automatically exported or sent over the network

---

## Neural Engine Breakdown

### 1. N-Gram Pattern Learning
```typescript
// Tracks: mnemonic word sequences → observed address patterns
{
  "word1 word2 word3": {
    addressPatterns: [
      { bytes: Buffer<20>, frequency: 5, avgHammingDistance: 8 },
      { bytes: Buffer<20>, frequency: 3, avgHammingDistance: 12 }
    ],
    totalObservations: 8
  }
}
```
- Built incrementally during mining
- When Hamming distance improves, the N-gram responsible is reinforced
- Helps the "brain" learn which word sequences tend toward the target

### 2. Entropy Bias Adaptation (Optional UI Toggle)
```typescript
{
  bias: 0.65,           // P(choose 24-word)
  rewards12: 45.2,      // Cumulative reward from 12-word strategy
  rewards24: 52.8,      // Cumulative reward from 24-word strategy
  lastImprovement: 0.15 // Magnitude of most recent distance decrease
}
```
- Dual-armed bandit strategy: dynamically adjust probability of 12-word vs 24-word
- User can toggle ON/OFF via checkbox to explore entropy effects
- Improves when Hamming distance decreases for chosen strategy

### 3. Statistical Seed-Bit Heatmap
```typescript
{
  entropyBitRegion: [0, 8],
  addressByteTargets: [0, 5, 19],  // Bytes most frequently improved
  correlationStrength: 0.72         // -1 (inverse) to +1 (direct)
}
```
- Analyzes correlation between random entropy bits and address byte patterns
- Feeds back into N-gram lookup for refined pattern prediction

### Hamming Distance Metric
- **Byte-level** (not bit-level) distance between derived address and target
- Formula: count of differing bytes in 20-byte address
- Perfect match: 0 (FOUND condition)
- Random addresses: expect ~10 bytes different on average
- Used to rank proximity and reinforce learning signals

---

## Configuration & Settings

### Miner Dashboard
- **Target Address**: Ethereum address (0x format)
- **Network**: Ethereum, BSC, Polygon (extensible)
- **Internal Path Depth**: Derivation account index range (m/44'/60'/0'/0/0 to N)
- **Archive All Attempts** (checkbox, default ON):
  - When enabled: every generated key persisted to IndexedDB for learning/lookup
  - When disabled: only FOUND keys exported (saves storage)
- **Entropy Bias Toggle**: Enable/disable learned 12-word vs 24-word adaptation

### Performance Settings
- **Balanced Mode** (default, ~75% CPU): Recommended for general use
  - Hardware detection: detects CPU cores, RAM, and adjusts thread count
  - Leaves ~25% capacity for OS/UI
- **Performance Mode** (100% CPU): Maximum throughput
  - Uses all logical cores
  - Toggle the button to switch modes on-the-fly (no restart needed)

### Neural Engine Panel
- **Proximity Gauge**: Current best Hamming distance
- **Entropy Strategy (RL)**: Visual representation of 12-word vs 24-word bias
- **Pattern Correlations**: Top N-grams and their frequency in mining attempts
- **Hardware Info**: Detected CPU model, core count, available RAM

---

## Debugging

### Development Mode
```bash
# Start dev server + Electron with hot reload
npm run dev

# In another terminal:
VITE_DEV_SERVER_URL=http://localhost:5174 npx electron .
```

**VPS Deployment (DigitalOcean) — Coordinator + 2 Workers**

This project can run in a distributed configuration where one droplet runs a lightweight coordinator and the other droplets run headless workers that perform mining using the full native kernel. The coordinator uses a simple WebSocket protocol to dispatch configs and receive logs/results. Instructions below assume Ubuntu/Debian Linux droplets.

1) Build Linux artifacts (on your build machine):

```bash
# Prepare and build Linux packages (AppImage / deb)
# Recommended: build on a Linux machine or inside Docker/WSL. Building on Windows may fail for AppImage/deb.
npm install
npm run build:linux
```

2) Prepare droplets (coordinator and workers):

On each droplet:

```bash
# Install Node.js 18+ (LTS) and git
apt update; apt install -y curl git build-essential
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# On coordinator droplet: clone repo and install minimal deps
git clone <your-repo-url> artemis && cd artemis
npm ci --production

# On worker droplets: clone repo and install full deps (native modules)
git clone <your-repo-url> artemis && cd artemis
# Build native modules for the local host (or install from your build pipeline)
npm ci
npm run build # optional if you need compiled electron assets
```

3) Start the coordinator (run on one droplet):

```bash
# By default coordinator listens on port 8080
npm run start:coordinator
# For production set port or run in background (systemd or tmux)
# COORD_PORT=9000 npm run start:coordinator
```

4) Start remote workers on the other droplets:

```bash
# Point workers at the coordinator's address
# Example: coordinator IP 203.0.113.5
COORD_HOST=203.0.113.5 COORD_PORT=8080 npm run start:worker
# Or run with process manager (pm2/systemd)
```

5) Coordinator CLI

The coordinator runs a small REPL. Use `list()` to list connected workers and `broadcast(obj)` to send a config object (JSON) to all workers. Example object to start miners:

```js
{ action: 'START', config: { targetAddress: '0x...', network: 'ETH', threads: 3, checkpointDir: '/tmp/artemis_sessions' } }
```

Notes & caveats
- Native modules: `tiny-secp256k1`, `keccak`, and `better-sqlite3` contain native code. On worker droplets you must install and build these native modules for the target OS/arch. Use `npm ci` on those droplets or cross-compile artifacts in CI and copy the `node_modules`.
- Building on Windows: electron-builder will attempt to create Linux packages (AppImage/deb) but requires Linux tooling (mksquashfs, fpm). To avoid these host dependencies, build inside Docker or on a Linux host. Example with the provided Dockerfile:

```bash
# Build container image (run from repo root)
docker build -f tools/docker-build/Dockerfile -t artemis-builder:latest .
# Run container to produce artifacts (release-build will be written inside container; mount a host folder to collect results)
docker run --rm -v "$PWD/release-build:/project/release-build" artemis-builder:latest
```
- If you want to run the Electron UI on a VPS, prefer running it on a dedicated droplet with a desktop environment and X11/Wayland forwarding — not recommended. The coordinator/worker approach allows fully headless mining on Linux.
- Security: the WebSocket protocol here is intentionally simple. For production, secure the connection (TLS + auth) or run the coordinator inside a private network (VPC) and use firewall rules.


### Console Logs
- **Main Process**: Printed to terminal where `npx electron .` was started
- **Renderer**: DevTools console (automatically opened, or press Ctrl+Shift+I)
- **Worker**: Logged to main, then forwarded to renderer as `LOG` messages

### Error Forwarding
- Renderer errors automatically forwarded to main via `RENDERER_ERROR` IPC
- Main logs capture and display preload/IPC issues
- StartupGate component shows clear error messages if native bridge is missing

### Session Debugging
- Check `session_<target>.dat` for brain state snapshot
- Inspect IndexedDB `keys` table to verify persistence
- Watch `LEARNING` and `SAMPLE` messages in renderer log

---

## Troubleshooting

### Blank UI / No Loading Indicator
- **Cause**: Asset paths relative (file:// protocol requires `./` not `/`)
- **Fix**: Check `dist/index.html` has `src="./assets/..."` (not `/assets/...`)
- **Rebuild**: `npm run build` regenerates dist

### Worker Threads Fail to Start
- **Cause**: `miner-kernel.js` missing from `dist-electron/`
- **Debug**: Check terminal for `[MAIN] Using source miner-kernel.js` log
- **Fix**: Build runs vita plugin to copy kernel; if missing, fallback uses source
- **Manual Copy**: `cp electron/miner-kernel.js dist-electron/`

### Native Bridge Not Detected
- **UI Message**: "Native bridge not detected. Are you running inside the packaged Electron app?"
- **Cause**: Preload not loaded or context isolation blocking window.electron
- **Fix**: Verify `electron/preload.ts` path matches `PRELOAD_PATH` in main
- **Debug**: Open DevTools, run `console.log(window.electron)` to verify exposure

### Mining Never Starts (Button Click No Response)
- **Cause**: IPC handler not registered or config malformed
- **Debug**: Watch terminal for `[MAIN] Initializing X Native Kernels...` log
- **Fix**: Verify target address is valid (non-empty, 42 chars, starts with 0x)
- **Manual Test**: DevTools console → `window.electron.startMining({ targetAddress: '0x...', network: 'ETH' })`

### Performance Issues (UI Lag During Mining)
- **Cause**: Mining threads using all cores, UI thread starved
- **Expected**: Should see ~75-80% total CPU (3 cores mining, 1 core free)
- **Fix**: Verify `MINING_THREADS = 3` in main.ts (auto-calculated as `cores - 1`)
- **Manual**: Reduce `MINING_THREADS` to 2 if i7+ (frees more cores for OS/UI)

---

## Build Configuration

### Key Files
- `package.json`: Scripts, build target, ASAR config, native module unpacking
- `vita.config.ts`: Vite + Electron plugin config, external deps, miner-kernel copy
- `tsconfig.json`: React/ESNext, strict mode
- `tsconfig.electron.json`: CommonJS target for main process (ES2022 → CommonJS)
- `.github/copilot-instructions.md`: AI agent guidelines for development

### External Modules (Not Bundled)
- `tiny-secp256k1`: C++ native binding for Secp256k1
- `keccak`: C++ native binding for Keccak-256 hashing
- `bip39`: BIP-39 mnemonic generation
- `ethers`: Address derivation utilities
- `systeminformation`: Hardware monitoring

These are unpacked from ASAR during installation to ensure native bindings work.

### SSE4.2 Compiler Flags
- **Target CPU**: i5-760 (Nehalem/Westmere, 2008-2010)
- **Flag**: `arch:SSE4.2` (not AVX2; avoids "Illegal Instruction" crashes)
- **Build Tool**: Visual Studio 2022 or node-pre-gyp integration
- **Check**: If app crashes with "Illegal Instruction", verify C++ bindings compiled with SSE flags

---

## Development Roadmap

### Completed
✅ Neural engine N-gram correlation learning  
✅ Entropy bias adaptation (12-word vs 24-word toggle)  
✅ Session checkpoint persistence (resume on crash)  
✅ Hardware monitoring (CPU, RAM, temp)  
✅ 3-core thread affinity for smooth UI  
✅ Address vulnerability analysis (Profanity, precompiled, vanity)  
✅ ErrorBoundary + StartupGate for clear error reporting  

### Planned
- [ ] Move session checkpoints to `%APPDATA%/Artemis/` (Windows user data)
- [ ] Implement seed-bit heatmap visualization in UI
- [ ] Add persistent session history (resume past target addresses)
- [ ] Export mining statistics (CSV, JSON)
- [ ] GPU acceleration for address derivation (CUDA/OpenCL)
- [ ] Multi-network support (Bitcoin, Solana, Cosmos)
- [ ] Web UI (React Server Components)

---

## Security Notes

### Private Key Handling
- **Generation**: On-device only, no external APIs
- **Storage**: IndexedDB (browser storage), encrypted if OS-level encryption enabled
- **Export**: **Only on explicit FOUND events**; user explicitly clicks to save key
- **Memory**: Stack-allocated in hot loop; no heap leaks from intermediate keys
- **Network**: No network calls during mining

### Attack Vectors Detected
- **Profanity Tool Vulnerabilities**: Flags addresses with long vanity prefixes
- **Precompiled Contracts**: Detects impossible-to-derive addresses (0x0001-0x0009)
- **CREATE2 Patterns**: Warns of smart contract proxy addresses (0x00000000 prefix)
- **Low Entropy**: Shannon entropy check on address bytes

### Recommendations
- Run on a machine with full disk encryption (BitLocker, FileVault)
- Close DevTools before sensitive mining sessions (avoid logging private keys)
- Backup `session_<target>.dat` periodically (contains brain state but not keys)

---

## Licensing

Artemis 2.0 is provided as-is for educational and research purposes.

---

## Contributors

Built with ❤️ for the cryptographic research community.

**Questions or Issues?** Open a GitHub issue or check the Copilot instructions for developer guidelines.
