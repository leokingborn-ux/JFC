
const { parentPort, workerData } = require('worker_threads');
// Global handlers to surface unexpected crashes back to main process
process.on('uncaughtException', (err) => {
    try { parentPort && parentPort.postMessage({ type: 'LOG', payload: `[K${workerData ? workerData.threadId : '?'}] UNCAUGHT: ${err.message}` }); } catch (e) {}
    console.error('UNCAUGHT', err);
    process.exit(1);
});
process.on('unhandledRejection', (r) => {
    try { parentPort && parentPort.postMessage({ type: 'LOG', payload: `[K${workerData ? workerData.threadId : '?'}] UREJ: ${String(r)}` }); } catch (e) {}
    console.error('UNHANDLED REJECTION', r);
});
const crypto = require('crypto');
const ecc = require('tiny-secp256k1');
// Use pure-JS keccak to avoid NAPI crashes in Electron worker threads
const { keccak256: jsKeccak } = require('js-sha3');
const bip39 = require('bip39');
const fs = require('fs');
const path = require('path');
// Allow worker to optionally run in remote mode and send messages via callback
// When used as a standalone worker thread (remote-worker.js) messages are
// posted via parentPort and coordinated by the remote process. No network
// logic added here to keep kernel simple and portable.

// Configuration from Main Process
const { config, threadId } = workerData;
const BATCH_SIZE = 2000; 
let running = true;

// --- REINFORCEMENT LEARNING STATE (Dual-Armed Bandit) ---
let entropyBias = config.entropyBias || 0.5;
let rewards12 = config.resumeData ? config.resumeData.rewards12 : 1.0;
let rewards24 = config.resumeData ? config.resumeData.rewards24 : 1.0;
let bestDistance = config.resumeData ? config.resumeData.bestHammingDistance : 1000;
let iterations = config.resumeData ? config.resumeData.iterations : 0;
let lastImprovement = 0; // Track magnitude for dynamic sensitivity

// Correlation Matrix (The "Brain")
const correlationMatrix = {}; 

// Session checkpoint timing
let lastSessionWrite = Date.now();
const SESSION_INTERVAL = 60000; // 60s checkpoint

// Pre-calculate target buffer for ultra-fast byte comparison
const targetBuffer = Buffer.from(config.targetAddress.replace('0x', ''), 'hex');

function privateToAddress(privateKey) {
  // 1. Validate & normalize private key
  if (!Buffer.isBuffer(privateKey)) {
    throw new Error('privateToAddress: privateKey must be a Buffer');
  }
  if (privateKey.length !== 32) {
    throw new Error(`privateToAddress: privateKey must be 32 bytes, got ${privateKey.length}`);
  }
  if (!ecc.isPrivate(privateKey)) {
    throw new Error('privateToAddress: invalid private key for secp256k1');
  }
  
  // 2. Public Key Derivation (Secp256k1) - C++ Native
  let publicKey;
  try {
    publicKey = ecc.pointFromScalar(privateKey, false);
    if (!publicKey) {
      throw new Error('ecc.pointFromScalar returned null/undefined');
    }
    // tiny-secp256k1 returns a Uint8Array; convert to Buffer for copy() and other operations
    if (!Buffer.isBuffer(publicKey)) {
      publicKey = Buffer.from(publicKey);
    }
  } catch (err) {
    throw new Error(`pointFromScalar failed: ${err.message}`);
  }
  
  // 3. Extract uncompressed public key (skip first byte of header)
  if (publicKey.length < 65) {
    throw new Error(`Public key extraction failed: got ${publicKey.length} bytes, expected at least 65`);
  }
  // Copy bytes into a new Buffer to avoid passing possibly-detached ArrayBuffer views into native code
  const pubKeyNoHeader = Buffer.alloc(64);
  publicKey.copy(pubKeyNoHeader, 0, 1, 65);
  if (pubKeyNoHeader.length !== 64) {
    throw new Error(`Public key extraction failed after copy: got ${pubKeyNoHeader.length} bytes, expected 64`);
  }
  // 4. Keccak Hashing - pure-JS to avoid Electron worker NAPI issues
  let hash;
  try {
    hash = Buffer.from(jsKeccak.digest(pubKeyNoHeader), 'hex');
  } catch (err) {
    throw new Error(`Keccak hashing failed: ${err.message}`);
  }
  
  if (!Buffer.isBuffer(hash) || hash.length !== 32) {
    throw new Error(`Keccak returned invalid hash: ${hash ? 'length ' + hash.length : 'null'}`);
  }
  
  // 5. Extract Address (Last 20 bytes)
  return hash.subarray(-20);
}

// Byte-level Hamming Distance (Zero-Copy optimization)
function calculateByteHamming(buf1, buf2) {
    let dist = 0;
    for (let i = 0; i < 20; i++) {
        if (buf1[i] !== buf2[i]) dist++;
    }
    return dist;
}

function mine() {
    let batchCount = 0;
    let lastReport = Date.now();
    
    parentPort.postMessage({ type: 'LOG', payload: `Kernel ${threadId} Online (Bias: ${entropyBias.toFixed(2)})` });

    while (running) {
        batchCount++;
        iterations++;
        
        // --- RL Step: Choose Entropy Length ---
        const use256 = Math.random() < entropyBias;
        
        // --- 1. Generation ---
        const entropy = crypto.randomBytes(use256 ? 32 : 16);
        // Derive mnemonic from entropy for N-gram analysis
        let mnemonic = null;
        try {
            mnemonic = bip39.entropyToMnemonic(entropy.toString('hex'));
        } catch (e) {
            mnemonic = null;
        }
        
        // --- 2. Key Derivation ---
        let privateKey;
        if (!use256) {
             // Fast-path: Use SHA256 of entropy as key for 12-word simulation speed
             privateKey = crypto.createHash('sha256').update(entropy).digest();
        } else {
             privateKey = entropy;
        }

        // Validate key BEFORE calling ecc.isPrivate (which is strict)
        if (!Buffer.isBuffer(privateKey) || privateKey.length !== 32) {
          continue; // Skip this iteration
        }
        
        if (!ecc.isPrivate(privateKey)) {
          continue; // Key is not valid for secp256k1; try next entropy
        }

        // --- 3. Address Gen ---
        let addressBuffer;
        try {
          addressBuffer = privateToAddress(privateKey);
        } catch (err) {
          // Log error and continue mining
          parentPort.postMessage({ type: 'LOG', payload: `[K${threadId}] Key derivation error: ${err.message}` });
          continue;
        }

        // --- 4. Heuristic Analysis (The "Brain") ---
        const dist = calculateByteHamming(addressBuffer, targetBuffer);
        
        if (dist < bestDistance) {
            const improvement = (bestDistance - dist) / bestDistance;
            bestDistance = dist;
            lastImprovement = improvement; // Capture magnitude
            
            // Reward the successful strategy
            const reward = 1.0 + (improvement * 50);
            if (use256) rewards24 += reward;
            else rewards12 += reward;

            parentPort.postMessage({ 
                type: 'LOG', 
                payload: `[K${threadId}] New Best Dist: ${dist} (${use256 ? '24w' : '12w'})` 
            });

            // Send learning update with simple n-gram extraction
            if (mnemonic) {
                const words = mnemonic.split(/\s+/).filter(Boolean);
                const bigrams = [];
                for (let i = 0; i < words.length - 1; i++) bigrams.push(words[i] + ' ' + words[i+1]);
                parentPort.postMessage({
                    type: 'LEARNING',
                    payload: {
                        threadId,
                        bestDistance: dist,
                        ngrams: {
                            unigrams: words.slice(0, 6),
                            bigrams: bigrams.slice(0, 6)
                        },
                        rewards12, rewards24
                    }
                });
            }
        }

        // --- 5. Target Check ---
        if (dist === 0) {
          const addressStr = '0x' + addressBuffer.toString('hex');
          parentPort.postMessage({
            type: 'FOUND',
            payload: { 
              mnemonic: mnemonic || null,
              privateKey: privateKey.toString('hex'), 
              address: addressStr 
            }
          });
            running = false;
        }

        // --- 6. Correlation Sampling (The "Neural" Map) ---
        if (batchCount % 1000 === 0) {
            const firstByte = entropy[0].toString(16); 
            const addrByte = addressBuffer[0].toString(16); 
            
            if (!correlationMatrix[firstByte]) correlationMatrix[firstByte] = {};
            if (!correlationMatrix[firstByte][addrByte]) correlationMatrix[firstByte][addrByte] = 0;
            correlationMatrix[firstByte][addrByte]++;
        }

        // --- 7. Batch Reporting & Adjustment ---
        if (batchCount % BATCH_SIZE === 0) {
            
            // Send speed stats
            parentPort.postMessage({
                type: 'STATS',
                payload: { hashes: BATCH_SIZE, threadId }
            });

            // Send a sample for archiving/learning (throttled to batch)
            if (privateKey && addressBuffer) {
                try {
                    const sample = {
                        mnemonic: mnemonic || null,
                        privateKey: privateKey.toString('hex'),
                        address: '0x' + addressBuffer.toString('hex'),
                        network: config.network || 'ETH',
                        timestamp: Date.now()
                    };
                    parentPort.postMessage({ type: 'SAMPLE', payload: sample });
                } catch (e) {
                    parentPort.postMessage({ type: 'LOG', payload: `[K${threadId}] Sample message failed: ${e.message}` });
                }
            }

            // --- Dynamic Bias Adjustment (Sensitivity) ---
            const totalRewards = rewards12 + rewards24;
            const rawBias = rewards24 / totalRewards;
            
            // Dynamic Sensitivity based on magnitude of recent improvements
            const sensitivity = Math.min(0.2, Math.max(0.005, lastImprovement * 10));
            
            // Update Bias
            entropyBias = (entropyBias * (1 - sensitivity)) + (rawBias * sensitivity);
            entropyBias = Math.max(0.05, Math.min(0.95, entropyBias));
            
            // Decay
            lastImprovement *= 0.95;

            // --- Checkpoint & Visuals (Throttled 2s) ---
            const now = Date.now();
            if (now - lastReport > 2000) {
                lastReport = now;
                
                const topPatterns = [];
                let pCount = 0;
                for (const w in correlationMatrix) {
                    if (pCount > 5) break;
                    for (const a in correlationMatrix[w]) {
                        if (correlationMatrix[w][a] > 2) {
                            topPatterns.push({ wordProxy: w, addrPrefix: a, count: correlationMatrix[w][a] });
                        }
                    }
                    pCount++;
                }

                parentPort.postMessage({
                    type: 'CHECKPOINT',
                    payload: {
                        entropyBias,
                        rewards12,
                        rewards24,
                        bestDistance,
                        totalPatternsAnalyzed: iterations,
                        topPatterns
                    }
                });
            }

            // --- Periodic Binary Session Checkpoint (every 60s) ---
            if (Date.now() - lastSessionWrite > SESSION_INTERVAL) {
                lastSessionWrite = Date.now();
                try {
                    const session = {
                        targetAddress: config.targetAddress,
                        lastUpdated: Date.now(),
                        entropyBias,
                        rewards12,
                        rewards24,
                        bestDistance,
                        iterations,
                        correlationMatrix
                    };
                    const dir = config && config.checkpointDir ? config.checkpointDir : process.cwd();
                    const outPath = path.join(dir, `session_${config.targetAddress.replace(/0x/, '')}.dat`);
                    fs.writeFileSync(outPath, Buffer.from(JSON.stringify(session)));
                    parentPort.postMessage({ type: 'LOG', payload: `[K${threadId}] Wrote session checkpoint to ${outPath}` });
                } catch (e) {
                    parentPort.postMessage({ type: 'LOG', payload: `[K${threadId}] Failed writing session checkpoint: ${e.message}` });
                }
            }
        }
    }
}

// Wrap the mine() call to catch unhandled errors
try {
  mine();
} catch (err) {
  console.error('MINE SYNC ERROR', err);
  process.exit(1);
}

