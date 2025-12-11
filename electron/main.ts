import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import si from 'systeminformation';
import * as path from 'path';
import { Worker } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import SqliteDB from './sqlite-db';

// Constants
const AVAILABLE_CORES = os.cpus().length;
const DEFAULT_MINING_THREADS = Math.max(1, AVAILABLE_CORES - 1);
// current mining thread count (adjustable via IPC / UI)
let currentMiningThreads = DEFAULT_MINING_THREADS;

let win: BrowserWindow | null;
let miningWorkers: Worker[] = [];

// Handle path resolution for both dev (src/electron) and prod (dist-electron)
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const DIST = path.join(__dirname, '../dist');

// Application root for storing sessions/logs.
// Use `ARTEMIS_DATA_DIR` env var if provided, otherwise prefer the
// directory the process was started from (`process.cwd()`). This ensures
// all files are stored in the folder the app is being run from (and not
// in user profiles or Program Files when packaged).
const APP_ROOT = process.env.ARTEMIS_DATA_DIR ? path.resolve(process.env.ARTEMIS_DATA_DIR) : process.cwd();
const LOG_DIR = path.join(APP_ROOT, 'artemis_logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }

// Initialize a process-local SQLite DB under APP_ROOT/db/artemis.db
const DB_DIR = path.join(APP_ROOT, 'db');
const DB_FILE = path.join(DB_DIR, 'artemis.db');
try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch (e) {}
let sqliteDb: SqliteDB | null = null;
try {
  sqliteDb = new SqliteDB(DB_FILE);
  // initialize asynchronously; log when ready
  sqliteDb.init().then(() => {
    appendLog('info', `SQLite DB initialized at ${DB_FILE} (driver=${(sqliteDb as SqliteDB).driver})`);
  }).catch((err) => {
    appendLog('error', `SQLite DB init failed: ${String(err)}`);
  });
} catch (e) {
  appendLog('error', `SQLite DB construction failed: ${(e as Error).message}`);
}

function appendLog(level: string, msg: string) {
  try {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line, { encoding: 'utf8' });
  } catch (e) {
    // best-effort
  }
}

function createWindow() {
  console.log('[MAIN] Preload Path:', PRELOAD_PATH);

  win = new BrowserWindow({
    width: 1300,
    height: 950,
    backgroundColor: '#020617',
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false 
    },
    autoHideMenuBar: true,
    title: "Artemis 2.0 [Native Engine]"
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(DIST, 'index.html'));
  }
  try {
    win.webContents.openDevTools({ mode: 'detach' });
  } catch (e) {
    console.warn('Could not open DevTools:', e);
  }
}

app.whenReady().then(createWindow);

// Developer-mode simulation: when SIMULATE_RUN=1 is set, send a small sequence of miner messages
if (process.env.SIMULATE_RUN === '1') {
  app.whenReady().then(() => {
    setTimeout(() => {
      try {
        if (win) {
          win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: '[SIM] Starting simulated miner sequence' });
          win?.webContents.send('MINER_UPDATE', { type: 'STATS', payload: { hashes: 2000, threadId: 0 } });
          win?.webContents.send('MINER_UPDATE', { type: 'CHECKPOINT', payload: { entropyBias: 0.5, rewards12: 1, rewards24: 1, bestDistance: 18, totalPatternsAnalyzed: 52000, topPatterns: [{wordProxy:'ab', addrPrefix:'00', count:5}] } });
          // Simulate FOUND after short delay
          setTimeout(() => {
            win?.webContents.send('MINER_UPDATE', { type: 'FOUND', payload: { mnemonic: 'simulated mnemonic', privateKey: '0x' + 'aa'.repeat(32), address: '0x000000000000000000000000000000000000dEaD' } });
          }, 1200);
        }
      } catch (e) {
        console.warn('Simulation failed', e);
      }
    }, 800);
  });
}

// --- IPC HANDLERS ---

ipcMain.on('START_MINING', (event, config) => {
  if (miningWorkers.length > 0) return; 

  console.log(`[MAIN] Initializing ${currentMiningThreads} Native Kernels...`);
  
  // Resolve kernel path: prefer built `dist-electron/miner-kernel.js`, fallback to source `electron/miner-kernel.js`
  // Typical locations:
  // - dev: electron/miner-kernel.js (process.cwd())
  // - prod packed: resources/app.asar/dist-electron/miner-kernel.js (inside ASAR) -> NOT usable by Worker
  // - prod unpacked: resources/app.asar.unpacked/dist-electron/miner-kernel.js (usable file)
  let workerPath = path.join(__dirname, 'miner-kernel.js');
  // If workerPath is inside ASAR and not accessible, prefer unpacked location
  if (!fs.existsSync(workerPath)) {
    // Try resourcesPath unpacked location
    try {
      const unpacked = path.join(process.resourcesPath || process.cwd(), 'app.asar.unpacked', 'dist-electron', 'miner-kernel.js');
      if (fs.existsSync(unpacked)) {
        workerPath = unpacked;
        console.log('[MAIN] Using unpacked miner-kernel.js at', unpacked);
      } else {
        const alt = path.join(process.cwd(), 'electron', 'miner-kernel.js');
        if (fs.existsSync(alt)) {
          workerPath = alt;
          console.log('[MAIN] Using source miner-kernel.js at', alt);
        }
      }
    } catch (e) {
      const alt = path.join(process.cwd(), 'electron', 'miner-kernel.js');
      if (fs.existsSync(alt)) {
        workerPath = alt;
        console.log('[MAIN] Using source miner-kernel.js at', alt);
      }
    }
  }
  
  // Provide a stable checkpoint directory inside the user's app data
  const checkpointDir = path.join(APP_ROOT, 'sessions');
  try { fs.mkdirSync(checkpointDir, { recursive: true }); } catch (e) { /* ignore */ }

  // Test native module loading inside a worker thread first to detect ABI issues
  try {
    let testWorkerPath = path.join(__dirname, 'test-native-loader.js');
    if (!fs.existsSync(testWorkerPath)) {
      const altTest = path.join(process.cwd(), 'electron', 'test-native-loader.js');
      if (fs.existsSync(altTest)) testWorkerPath = altTest;
    }
    if (fs.existsSync(testWorkerPath)) {
      const testWorker = new Worker(testWorkerPath);
      const ready = new Promise((resolve) => {
        const to = setTimeout(() => resolve({ ok: false, message: 'timeout' }), 1500);
        testWorker.on('message', (m) => { clearTimeout(to); resolve(m); });
        testWorker.on('error', (err) => { clearTimeout(to); resolve({ ok: false, message: err.message }); });
        testWorker.on('exit', (c) => { /* ignore */ });
      });
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      ready.then((res: any) => {
        if (res && res.ok) {
          console.log('[MAIN] Native test worker: success');
          win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: '[MAIN] Native test worker: success' });
            appendLog('info', 'Native test worker: success');
        } else {
          console.error('[MAIN] Native test worker failed:', res && res.message);
          win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: `[MAIN] Native test worker failed: ${res && res.message}` });
            appendLog('error', `Native test worker failed: ${res && res.message}`);
        }
      });
    }

    // Run a light-weight miner loop in a worker to reproduce address derivation path under Electron
    try {
      let loopPath = path.join(__dirname, 'test-miner-loop.js');
      if (!fs.existsSync(loopPath)) loopPath = path.join(process.cwd(), 'electron', 'test-miner-loop.js');
      if (fs.existsSync(loopPath)) {
        const loopWorker = new Worker(loopPath);
        const loopReady = new Promise((resolve) => {
          const to = setTimeout(() => resolve({ ok: false, message: 'timeout' }), 5000);
          loopWorker.on('message', (m) => { clearTimeout(to); resolve(m); });
          loopWorker.on('error', (err) => { 
            clearTimeout(to);
            console.error('[MAIN] Miner-loop worker error:', err && err.message);
            resolve({ ok: false, message: err && err.message });
          });
          loopWorker.on('exit', (c) => { /* ignore */ });
        });
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        loopReady.then((res: any) => {
          if (res && res.ok) {
            console.log('[MAIN] Miner-loop test: success', res.iterations, res.successes);
            win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: `[MAIN] Miner-loop test: success ${res.iterations} iters, ${res.successes} addr` });
                  appendLog('info', `Miner-loop test success ${res.iterations} iters, ${res.successes} addr`);
          } else {
            console.error('[MAIN] Miner-loop test failed:', res && res.message);
            win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: `[MAIN] Miner-loop test failed: ${res && res.message}` });
                  appendLog('error', `Miner-loop test failed: ${res && res.message}`);
          }
        });
      }
    } catch (e) {
      console.warn('[MAIN] Miner-loop test setup failed', (e as Error).message || String(e));
    }
  } catch (e) {
    console.warn('[MAIN] Native test worker setup failed', (e as Error).message || String(e));
  }

  // Spawn workers using the current (possibly adjusted) thread count
  spawnMiningWorkers(currentMiningThreads, workerPath, config, checkpointDir);
});

// --- IPC: DB operations exposed to renderer via preload ---
ipcMain.handle('DB_SAVE_KEY', async (_evt, key) => {
  try {
    if (sqliteDb) sqliteDb.saveKey(key);
    appendLog('info', `DB_SAVE_KEY address=${key?.address}`);
    return { ok: true };
  } catch (e) { appendLog('error', `DB_SAVE_KEY failed ${(e as Error).message}`); return { ok: false, error: String(e) }; }
});

ipcMain.handle('DB_SAVE_KEYS', async (_evt, keys) => {
  try {
    if (sqliteDb) sqliteDb.saveKeyBatch(keys);
    appendLog('info', `DB_SAVE_KEYS count=${Array.isArray(keys) ? keys.length : 0}`);
    return { ok: true };
  } catch (e) { appendLog('error', `DB_SAVE_KEYS failed ${(e as Error).message}`); return { ok: false, error: String(e) }; }
});

ipcMain.handle('DB_GET_KEYS', async () => {
  try { const rows = sqliteDb ? sqliteDb.getKeys() : []; return { ok: true, rows }; } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('DB_SAVE_SESSION', async (_evt, target: string, payload: any) => {
  try { if (sqliteDb) sqliteDb.saveSession(target, payload); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('DB_GET_SESSION', async (_evt, target: string) => {
  try { const s = sqliteDb ? sqliteDb.getSession(target) : null; return { ok: true, session: s }; } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.on('STOP_MINING', () => {
  miningWorkers.forEach(w => w.terminate());
  miningWorkers = [];
  win?.webContents.send('SYSTEM_STATUS', { status: 'STOPPED', threads: 0 });
});

// Helper: spawn mining workers and wire messaging
function spawnMiningWorkers(count: number, workerPath: string, config: any, checkpointDir: string) {
  // terminate existing workers first
  miningWorkers.forEach(w => { try { w.terminate(); } catch (e) {} });
  miningWorkers = [];

  for (let i = 0; i < count; i++) {
    let worker: Worker | null = null;
    try {
      worker = new Worker(workerPath, {
        workerData: {
          threadId: i,
          config: { ...config, checkpointDir }
        }
      });
    } catch (e) {
      console.error(`[MAIN] Worker instantiation failed for thread ${i}:`, e && (e as Error).message || String(e));
      win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: `[MAIN] Worker instantiation failed for thread ${i}: ${(e as Error).message || String(e)}` });
      continue;
    }

    worker.on('message', (msg) => {
      win?.webContents.send('MINER_UPDATE', msg);
      try { appendLog('info', `KERNEL ${i} MSG: ${JSON.stringify(msg).substring(0,1000)}`); } catch {}
    });

    worker.on('error', (err) => {
      console.error(`[KERNEL ${i}] ERROR:`, err.message, err.stack);
      win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: `[KERNEL ${i}] ERROR: ${err.message}` });
    });

    worker.on('exit', (code) => {
      if (code === 0) {
        console.log(`[KERNEL ${i}] Worker exited normally (code 0)`);
      } else if (code === null) {
        console.warn(`[KERNEL ${i}] Worker terminated by signal (likely user interrupt)`);
      } else {
        console.error(`[KERNEL ${i}] Worker crashed with exit code ${code}`);
        win?.webContents.send('MINER_UPDATE', { type: 'LOG', payload: `[KERNEL ${i}] Crash with code ${code}` });
      }
    });

    miningWorkers.push(worker);
  }

  win?.webContents.send('SYSTEM_STATUS', { status: 'RUNNING', threads: count });
  appendLog('info', `SYSTEM_STATUS RUNNING threads=${count}`);
}

// IPC to provide hardware-optimized suggestions (recommended threads, full power threads)
ipcMain.handle('GET_OPTIMIZATION_SUGGESTION', async () => {
  try {
    const mem = await si.mem();
    const loadInfo = await si.currentLoad();
    const cpu = await si.cpu();
    const osInfo = await si.osInfo();

    const totalMemGB = Math.round((mem.total / (1024 ** 3)) * 10) / 10;
    const cores = AVAILABLE_CORES;

    // Basic heuristic:
    // - Balanced: ~75% of logical cores (preserves some capacity for OS/UI)
    // - Performance: 100% of logical cores (may impact UI responsiveness)
    // - If low memory (<4GB), reduce threads to avoid memory pressure
    let balanced = Math.max(1, Math.floor(cores * 0.75));
    if (totalMemGB < 4) balanced = Math.max(1, Math.floor(balanced / 2));

    return {
      recommended: {
        mode: 'balanced',
        threads: balanced,
        note: 'Uses ~75% of logical cores; reduces threads on low memory'
      },
      performance: {
        mode: 'performance',
        threads: cores,
        note: 'Uses all logical cores; may impact UI responsiveness'
      },
      detected: {
        cpuModel: cpu.manufacturer + ' ' + cpu.brand,
        cores,
        totalMemGB,
        load: Math.round(loadInfo.currentLoad)
      }
    };
  } catch (e) {
    return { error: String(e) };
  }
});

// IPC to set power mode: 'balanced' or 'performance'. If mining is active, respawn workers.
ipcMain.handle('SET_POWER_MODE', async (_evt, mode: 'balanced' | 'performance') => {
  try {
    const cores = AVAILABLE_CORES;
    if (mode === 'performance') {
      currentMiningThreads = cores;
    } else {
      currentMiningThreads = Math.max(1, cores - 1);
    }

    // If miners are already running, respawn them with new thread count
    if (miningWorkers.length > 0) {
      // Determine workerPath similar to START_MINING resolution
      let workerPath = path.join(__dirname, 'miner-kernel.js');
      if (!fs.existsSync(workerPath)) {
        const unpacked = path.join(process.resourcesPath || process.cwd(), 'app.asar.unpacked', 'dist-electron', 'miner-kernel.js');
        if (fs.existsSync(unpacked)) workerPath = unpacked;
        else {
          const alt = path.join(process.cwd(), 'electron', 'miner-kernel.js');
          if (fs.existsSync(alt)) workerPath = alt;
        }
      }

      // Use a lightweight default config when respawning
      const cfg = { targetAddress: null };
      const checkpointDir = path.join(APP_ROOT, 'sessions');
      spawnMiningWorkers(currentMiningThreads, workerPath, cfg, checkpointDir);
    }

    appendLog('info', `Power mode set to ${mode} threads=${currentMiningThreads}`);
    return { ok: true, threads: currentMiningThreads };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Handle graceful shutdown: terminate workers when app is closing
app.on('before-quit', () => {
  miningWorkers.forEach(w => {
    try { w.terminate(); } catch (e) { /* ignore */ }
  });
  miningWorkers = [];
});

ipcMain.handle('GET_HARDWARE_STATS', async () => {
  try {
    const mem = await si.mem();
    const loadInfo = await si.currentLoad();
    const cpuTempInfo = await si.cpuTemperature();

    const ramUsage = (mem.active / mem.total) * 100;
    const load = loadInfo.currentLoad; // percent
    const cpuTemp = cpuTempInfo.main || 0;

    // Try to include disk usage for the drive where APP_ROOT resides so the
    // renderer can display storage available to the app (important after
    // moving DB from IndexedDB -> filesystem).
    let diskUsage = 0;
    let diskTotal = 0;
    let diskUsed = 0;
    try {
      const fsInfo = await si.fsSize();
      const appRootDrive = path.parse(APP_ROOT).root.toLowerCase();
      // Find the fs entry matching the app root drive, fallback to first entry
      let fsEntry = fsInfo.find((f: any) => {
        const mp = String(f.mount || f.fs || '').toLowerCase();
        return mp.startsWith(appRootDrive) || mp === appRootDrive.replace('\\','');
      });
      if (!fsEntry && fsInfo.length > 0) fsEntry = fsInfo[0];
      if (fsEntry) {
        diskTotal = fsEntry.size || 0;
        diskUsed = fsEntry.used || 0;
        diskUsage = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
      }
    } catch (e) {
      // ignore disk errors
    }

    return {
      cpuTemp: Math.round(cpuTemp),
      ramUsage: Math.round(ramUsage * 10) / 10,
      load: Math.round(load),
      disk: {
        total: diskTotal,
        used: diskUsed,
        usagePercent: diskUsage
      }
    };
  } catch (e) {
    // Fallback
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      cpuTemp: 0,
      ramUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
      load: 0
    };
  }
});

ipcMain.handle('IMPORT_LEGACY_DATA', async () => {
    const { filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (filePaths && filePaths.length > 0) {
        try {
            const data = fs.readFileSync(filePaths[0], 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            console.error("Import failed", e);
            return null;
        }
    }
    return null;
});
// Listen for renderer-side forwarded errors
ipcMain.on('RENDERER_ERROR', (_evt: any, payload: any) => {
  console.error('[RENDERER ERROR]', payload);
  try { appendLog('error', `[RENDERER_ERROR] ${JSON.stringify(payload)}`); } catch {}
});

// Renderer console forwarding
ipcMain.on('RENDERER_LOG', (_evt: any, payload: any) => {
  try {
    const lvl = payload?.level || 'log';
    const message = payload?.message || '';
    appendLog(`renderer.${lvl}`, message);
  } catch (e) { /* ignore */ }
});

ipcMain.handle('GET_LAST_SESSION', async (_evt, targetAddress: string) => {
  try {
    const checkpointDir = path.join(APP_ROOT, 'sessions');
    const fileName = `session_${targetAddress.replace(/0x/, '')}.dat`;
    const p = path.join(checkpointDir, fileName);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p);
    return JSON.parse(raw.toString('utf-8'));
  } catch (e) {
    console.error('GET_LAST_SESSION failed', e);
    return null;
  }
});

ipcMain.handle('EXPORT_FOUND', async (_evt, payload: any) => {
  try {
    const base = path.join(APP_ROOT, 'ArtemisFound');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(base, ts);
    fs.mkdirSync(dir, { recursive: true });

    // write files
    if (payload.mnemonic) fs.writeFileSync(path.join(dir, 'mnemonic.txt'), String(payload.mnemonic), { encoding: 'utf8' });
    if (payload.privateKey) fs.writeFileSync(path.join(dir, 'privateKey.txt'), String(payload.privateKey), { encoding: 'utf8' });
    if (payload.address) fs.writeFileSync(path.join(dir, 'address.txt'), String(payload.address), { encoding: 'utf8' });

    appendLog('info', `EXPORT_FOUND saved to ${dir}`);
    return { path: dir };
  } catch (e) {
    console.error('EXPORT_FOUND failed', e);
    appendLog('error', `EXPORT_FOUND failed: ${String(e)}`);
    return { error: String(e) };
  }
});

const { clipboard } = require('electron');
ipcMain.handle('READ_CLIPBOARD', async () => {
  try {
    return clipboard.readText();
  } catch (e) {
    return '';
  }
});