# Artemis 2.0 - AI Agent Coding Guidelines

## Project Overview
Artemis Native is a high-performance Electron + React desktop app for cryptographic key generation and heuristic-based address mining. The architecture separates UI (React), IPC bridge (preload), and compute kernel (Worker Threads + native crypto libraries).

**Tech Stack**: Vite + TypeScript + React + Electron + Ethers.js + Dexie + Worker Threads  
**Build**: `npm run dev` (dev server), `npm run build` (Electron package)

---

## Architecture Essentials

### Three-Layer Separation
1. **Renderer (React UI)**: `src/App.tsx`, `src/components/` - React components with TailwindCSS
2. **Main Process (Electron)**: `electron/main.ts` - Window management, IPC handlers, worker spawning
3. **Worker Threads (Compute)**: `electron/miner-kernel.js` - Native key derivation, crypto operations

### IPC Communication Pattern
- **UI → Main**: `window.electron.startMining(config)` sends `START_MINING` event
- **Main → Renderer**: `win?.webContents.send('MINER_UPDATE', msg)` returns mining stats
- **Preload Bridge** (`electron/preload.ts`): Context-isolated API exposing 6 methods to window.electron
- **Critical**: All crypto operations happen in Worker threads; never block main thread

### Data Persistence
- **Dexie IndexedDB** (`src/services/database.ts`): 3 tables - keys, stats, sessions
- **Key fields**: `GeneratedKey` (mnemonic, privateKey, address, network, timestamp)
- **MiningSession**: Stores entropy bias, rewards, hamming distance per target address
- **Batch Import**: `importDatabaseData()` for legacy data, `saveKeyBatch()` for performance

---

## Critical Patterns & Conventions

### Crypto Dependencies (MUST stay external in build)
The `vita.config.ts` marks these as `external` in rollup config:
- `tiny-secp256k1` (C++ binding for key derivation)
- `keccak` (C++ binding for address hashing)
- `bip39`, `ethers`, `systeminformation`

**Why**: These have native Node.js bindings. In `package.build.asarUnpack`, we explicitly unpack them so they aren't bundled inside ASAR.

### Build Output Structure
- `dist/` - React app (served by Vite or embedded in ASAR)
- `dist-electron/` - Compiled main.js, preload.js, miner-kernel.js
- `vita.config.ts` plugin **copies** `miner-kernel.js` to dist-electron on build close

**Build Issue Risk**: If miner-kernel.js is missing post-build, mining will fail silently. Check the copy plugin runs.

### Component State Management
No Redux/Context—use local React state. Examples:
- `MinerDashboard.tsx`: 12 state vars for UI + 3 useRefs for refs (startTimeRef, hashCountRef)
- Refs persist across renders; crucial for timing calculations
- Always initialize state with sensible defaults (e.g., `NetworkType.ETHEREUM`)

### Address Analysis Heuristics
`src/services/analysis.ts` detects:
- **Precompiled contracts** (0x0000000000000000000000000000000000000001-9) → Impossible to derive
- **Null address** (0x0000...0000) → Impossible
- **Vanity weakness** (7+ repeating hex chars, 0xDEAD patterns) → Profanity tool vulnerabilities
- **CREATE2 optimization** (0x00000000 prefix) → Smart contract proxy
- **Entropy density** (Shannon entropy < 85) → Non-random generation

Result: `{ score: 0-100, label: Critical|Vulnerable|Weak|Standard|Hardened, derivationDifficulty, vectors[], warnings[] }`

### Neural Engine: Multi-Strategy Learning
The miner's "brain" learns from key generation to optimize proximity to target address via three parallel strategies:

**1. N-Gram Pattern Correlation**
- Tracks mnemonic word sequences (bigrams, trigrams) and their correlation with full 20-byte address output
- Builds a lookup table: `{ ngram → [observed_addresses] }` indexed by N-gram
- When Hamming distance improves, reinforces that N-gram as "signal-bearing"
- Detects patterns like: "words X+Y tend to produce addresses with low byte 3-5"
- Stored in `MiningSession.correlations` and persisted to binary `session.dat` checkpoint

**2. Entropy Bias Adaptation (Optional UI Toggle)**
- Compares 12-word (128-bit) vs 24-word (256-bit) entropy performance against target
- Tracks `rewards12` and `rewards24`: cumulative proximity improvements per strategy
- User can enable/disable via checkbox to explore entropy effects on convergence
- Learns which seed length is more effective for reaching this specific target address
- Improves when Hamming distance decreases → adapts bias toward better-performing seed length

**3. Statistical Seed-Bit Relationships**
- Analyzes correlation between random entropy bits and resulting address byte patterns
- Builds statistical heatmaps: "Which entropy regions produce which address characteristics?"
- Example: "Bits 0-7 with high values correlate with leading zero bytes in address"
- Feeds back into N-gram lookup to refine pattern prediction accuracy
- Part of the "brain" knowledge base for multi-faceted optimization

### Hamming Distance Metric
Byte-level (not bit-level) distance between derived address and target. Used to rank proximity:
```js
function calculateByteHamming(buf1, buf2) {
  let dist = 0;
  for (let i = 0; i < 20; i++) { // 20 bytes = 160 bits for Ethereum address
    if (buf1[i] !== buf2[i]) dist++;
  }
  return dist;
}
```
- Perfect match: dist = 0 (FOUND condition)
- Random addresses: expect ~10 bytes different on average
- Proximity improvements reinforce N-gram patterns and seed-bit correlations in the "brain"

### Session Persistence & Checkpoint Model
- **Every iteration**: Worker stores best N-grams, seed-bit correlations, and entropy bias to stack memory (zero-copy)
- **Every 60 seconds**: Binary checkpoint written to `session.dat` containing:
  - Current correlation matrix (N-gram → address patterns)
  - Entropy bias state (`rewards12`, `rewards24`)
  - Best Hamming distance found so far
  - Iteration count
  - Current random seed (for deterministic resume)
- **On resume**: Load `session.dat`, restore all brain state, continue mining from last seed
- **On crash/interrupt**: Application recovers state on next launch; no learning loss
- **Database**: Stores generated keys and derived public addresses for learning and lookup; `storeAll` defaults to `true`. The app only exports private keys on explicit `FOUND` events.

### Neural Engine Data Structures
The "brain" learns by building three interconnected knowledge bases:

**1. N-Gram Correlation Matrix**
```typescript
// Map of N-gram (e.g., "abandon abandon") to observed address byte patterns
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

**2. Entropy Bias State**
```typescript
{
  bias: 0.65,           // Probability of choosing 24-word (0-1)
  rewards12: 45.2,      // Cumulative improvement from 12-word attempts
  rewards24: 52.8,      // Cumulative improvement from 24-word attempts
  lastImprovement: 0.15 // Magnitude of most recent distance decrease
}
```

**3. Statistical Seed-Bit Heatmap**
```typescript
// Tracks which entropy bit ranges correlate with which address byte characteristics
{
  entropyBitRegion: [0, 8],
  addressByteTargets: [0, 5, 19],  // Bytes most frequently improved
  correlationStrength: 0.72         // -1 (inverse) to +1 (direct)
}
```

All three are checkpointed to `session.dat` every 60 seconds and restored on resume.
```
### Address Analysis Heuristics
`src/services/analysis.ts` detects:
- **Precompiled contracts** (0x0000000000000000000000000000000000000001-9) → Impossible to derive
- **Null address** (0x0000...0000) → Impossible
- **Vanity weakness** (7+ repeating hex chars, 0xDEAD patterns) → Profanity tool vulnerabilities
- **CREATE2 optimization** (0x00000000 prefix) → Smart contract proxy
- **Entropy density** (Shannon entropy < 85) → Non-random generation

Result: `{ score: 0-100, label: Critical|Vulnerable|Weak|Standard|Hardened, derivationDifficulty, vectors[], warnings[] }`

### Neural Engine Data Structures
All three are checkpointed to `session.dat` every 60 seconds and restored on resume.
```typescript
// Map of N-gram (e.g., "abandon abandon") to observed address byte patterns
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

**2. Entropy Bias State**
```typescript
{
  bias: 0.65,           // Probability of choosing 24-word (0-1)
  rewards12: 45.2,      // Cumulative improvement from 12-word attempts
  rewards24: 52.8,      // Cumulative improvement from 24-word attempts
  lastImprovement: 0.15 // Magnitude of most recent distance decrease
}
```

**3. Statistical Seed-Bit Heatmap**
```typescript
// Tracks which entropy bit ranges correlate with which address byte characteristics
{
  entropyBitRegion: [0, 8],
  addressByteTargets: [0, 5, 19],  // Bytes most frequently improved
  correlationStrength: 0.72         // -1 (inverse) to +1 (direct)
}
```

All three are checkpointed to `session.dat` every 60 seconds and restored on resume.
  - Best Hamming distance found so far
  - Iteration count
  - Current random seed (for deterministic resume)
- **On resume**: Load `session.dat`, restore all brain state, continue mining from last seed
- **On crash/interrupt**: Application recovers state on next launch; no learning loss
- **Database**: Only saves generated keys with matching target address, not intermediate generations

---

## Common Workflows

### Adding a New UI Component
1. Create in `src/components/YourComponent.tsx` with `export default function`
2. Import React hooks + Lucide icons as needed
3. Use TailwindCSS with custom color scheme (indigo-500, emerald-500, slate-800 backdrop)
4. Access `window.electron` if you need IPC calls
5. Import `types.ts` for TypeScript interfaces (NetworkType, MiningSession, etc.)

### Extending Database
1. Add schema to `KeyDatabase` constructor in `database.ts` (increment version number)
2. Define new table with Dexie index signature (e.g., `myTable: '++id, name, date'`)
3. Export CRUD functions (getX, saveX, deleteX)
4. Call from React components via `useEffect` + error handling

### Modifying Worker Compute
1. Edit `electron/miner-kernel.js` (plain Node.js, no TypeScript)
2. Send messages via `parentPort.postMessage({ type, payload })`
3. Expected types: `'LOG'`, `'STATS'`, `'FOUND'`, `'CHECKPOINT'`
4. After build, kernel runs in Worker thread context (no DOM, no window object)

### Debugging IPC Issues
- **Main process logs**: Run with `npm run dev` to see console in terminal
- **Renderer logs**: DevTools (Ctrl+Shift+I in running app) shows React errors
- **Worker thread errors**: Logged by main process error handler, sent to renderer via `'LOG'` type
- **Test communication**: Add `console.log` in preload.ts to verify bridge exposure

---

## Hardware Optimization Strategy

### CPU Constraints (i5-760: 4 Cores, 4 Threads, No Hyperthreading)
- **SSE4.2 Support**: i5-760 (Nehalem/Westmere) supports SSE4.1 and SSE4.2, not AVX/AVX2
- **Compiler Flags**: Build must use `arch:SSE4.2` to leverage SIMD without "Illegal Instruction" crashes
- **SIMD Intrinsics**: Mining kernel uses SSE4.2 intrinsics (`_mm_*` functions) for 4-wide parallel operations
- **3-Core Mining Rule**: Launch exactly 3 worker threads, leave Core 0 free for OS/UI
  - Result: Mining at ~100% on cores 1-3, OS/Electron smooth on core 0 → ~75-80% total CPU usage
  - Prevents mouse stutter and window freeze from resource contention

### Memory Management: Zero-Copy Model
- **Hot Loop (Generate→Hash→Check)**: All stack-allocated, no heap allocation in tight loop
- **Instant Reuse**: Stack memory discarded after each key check; prevents fragmentation
- **Circular Buffer**: Worker maintains fixed memory block for stats (totalHashes counter)
- **UI Snapshot Only**: Renderer requests stats snapshot every 200ms, not per iteration
  - Decouples UI rendering speed from mining speed
  - Result: Silky smooth UI without lag from frequent IPC messages

### Checkpoint & Persistence
- **Binary Format** (`session.dat`): Compact serialization of correlation matrix, entropy bias, iteration state
- **Frequency**: Every 60 seconds, worker pauses for ~1ms to write checkpoint
- **Crash Proof**: Power loss or crash → resume from last checkpoint, no learning loss
- **State Recovered**: Correlation matrix, entropy bias, best distance, random seed fully restored

### Hardware Monitoring (Sidecar Approach)
- **Library**: `systeminformation` in main process only
- **Poll Rate**: Every 2 seconds (not per iteration) to avoid CPU overhead
- **Data Points**: CPU temperature, RAM usage, disk write speed
- **Impact**: <0.1% CPU overhead due to slow sensor reads vs fast mining

## Build & Deployment

### Development
```bash
npm run dev              # Concurrent Vite dev server + auto-restart Electron
```

### Production Build
```bash
npm run build            # TypeScript compile → Vite bundle → Electron-builder NSIS
```
Outputs to `release/` folder. NSIS config in `package.json` build section.

### Key Build Config Details
- **tsconfig.json**: Strict mode ON, noEmit ON (Vite handles emit), jsx: react-jsx
- **TypeScript paths**: Configured for `src/`, `electron/` directories
- **Preload must use CommonJS**: Electron's preload runs outside Vite context
- **External modules**: Rollup prevents bundling of C++ bindings (see vita.config)
- **SSE4.2 Compiler Flags**: Native worker bindings compiled with `arch:SSE4.2` for i5-760 optimization
- **3-Core Thread Affinity**: Main process must enforce 3-worker limit with core pinning (cores 1-3)
---

## Important Files Reference

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component; tab navigation (Miner/Generator) |
| `src/components/MinerDashboard.tsx` | Mining UI; starts workers, displays stats, logs |
| `src/components/KeyGenerator.tsx` | BIP-39 key generation; entropy scoring |
| `src/services/analysis.ts` | Address heuristics, entropy calculations |
| `src/services/database.ts` | Dexie ORM; key/session storage |
| `electron/main.ts` | Electron app entry; window + IPC setup |
| `electron/preload.ts` | Context-isolated bridge to window.electron |
| `electron/miner-kernel.js` | Worker thread compute (Secp256k1 + Keccak) |
| `vita.config.ts` | Vite plugin config; external deps, copy plugin |

---

## Red Flags & Gotchas

- **Missing miner-kernel.js post-build**: Check vita.config copy plugin ran
- **Worker path resolution**: main.ts uses `path.join(__dirname, 'miner-kernel.js')` — must match bundle output
- **ASAR unpacking**: Native modules must be unpacked in package.json build config
- **Preload context**: No require() for Vite-bundled code; only use in main process
- **Database version mismatch**: Incrementing version in Dexie constructor triggers migration
- **Entropy bias drift**: RL state can get stuck; consider periodic reset or cooldown
- **UI blocking**: All heavy compute must use `window.electron.startMining()`, never synchronous loops

---

## Code Style Notes

- **Naming**: camelCase for functions/variables, PascalCase for components/types/enums
- **Error handling**: Try-catch in async functions; fallback defaults (e.g., `session || null`)
- **Comments**: Document "why" for heuristics (e.g., Profanity vulnerability detection)
- **Logging**: Use `log()` function in components to push to UI log panel with timestamp
- **Tailwind**: Use existing classes from App.tsx (glass-panel, slate-950, indigo-600, etc.)
