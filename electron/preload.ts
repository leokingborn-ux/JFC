import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  startMining: (config: any) => ipcRenderer.send('START_MINING', config),
  stopMining: () => ipcRenderer.send('STOP_MINING'),
  getHardwareStats: () => ipcRenderer.invoke('GET_HARDWARE_STATS'),
  importLegacyData: () => ipcRenderer.invoke('IMPORT_LEGACY_DATA'),
  onMinerUpdate: (callback: any) => ipcRenderer.on('MINER_UPDATE', (_event, value) => callback(value)),
  onSystemStatus: (callback: any) => ipcRenderer.on('SYSTEM_STATUS', (_event, value) => callback(value)),
  removeListeners: () => {
      ipcRenderer.removeAllListeners('MINER_UPDATE');
      ipcRenderer.removeAllListeners('SYSTEM_STATUS');
  }
  ,
  getLastSession: (target: string) => ipcRenderer.invoke('GET_LAST_SESSION', target),
  exportFound: (payload: any) => ipcRenderer.invoke('EXPORT_FOUND', payload),
  readClipboard: () => ipcRenderer.invoke('READ_CLIPBOARD')
  ,
  // Optimization IPCs
  getOptimizationSuggestion: () => ipcRenderer.invoke('GET_OPTIMIZATION_SUGGESTION'),
  setPowerMode: (mode: 'balanced' | 'performance') => ipcRenderer.invoke('SET_POWER_MODE', mode),
  // DB IPC wrappers
  db: {
    saveKey: (k: any) => ipcRenderer.invoke('DB_SAVE_KEY', k),
    saveKeys: (ks: any[]) => ipcRenderer.invoke('DB_SAVE_KEYS', ks),
    getKeys: () => ipcRenderer.invoke('DB_GET_KEYS'),
    saveSession: (target: string, payload: any) => ipcRenderer.invoke('DB_SAVE_SESSION', target, payload),
    getSession: (target: string) => ipcRenderer.invoke('DB_GET_SESSION', target),
  }
});

// Basic diagnostic forwarding: capture renderer errors and forward to main
try {
  console.log('[PRELOAD] loaded');
  if (typeof globalThis !== 'undefined' && typeof (globalThis as any).addEventListener === 'function') {
    (globalThis as any).addEventListener('error', (e: any) => {
      try { ipcRenderer.send('RENDERER_ERROR', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }); } catch {}
    });
    (globalThis as any).addEventListener('unhandledrejection', (e: any) => {
      try { ipcRenderer.send('RENDERER_ERROR', { message: e.reason?.message || String(e.reason) }); } catch {}
    });
  }
} catch (e) {
  // ignore in restricted contexts
}

// Forward console calls (log/warn/error/info) to main process for persistent logging
try {
  const methods = ['log', 'warn', 'error', 'info'] as const;
  methods.forEach((m) => {
    const orig = (console as any)[m];
    (console as any)[m] = function (...args: any[]) {
      try {
        const message = args.map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        // Limit size to avoid huge IPC messages
        ipcRenderer.send('RENDERER_LOG', { level: m, message: message.substring(0, 2000) });
      } catch {}
      try { orig.apply(console, args); } catch {}
    };
  });
} catch (e) {
  // ignore
}