
import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Database, Terminal, Cpu, Upload, Trash2, RotateCcw, Activity, ShieldAlert, Target, HardDrive, Network, Settings, Share2, AlertTriangle, Zap } from 'lucide-react';
import { MiningSession, NetworkType } from '../types';
import { importDatabaseData, getDbStats, clearDatabase, saveSession, getSession, saveKey } from '../services/database';
import { analyzeTargetAddress } from '../services/analysis';

export default function MinerDashboard() {
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState('0x000000000000000000000000000000000000dEaD');
  const [network, setNetwork] = useState<NetworkType>(NetworkType.ETHEREUM);
  const [stats, setStats] = useState({ totalHashes: 0, speed: 0, dbCount: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [hwStats, setHwStats] = useState({ ram: 0, load: 0, temp: 0 });
  const [targetAnalysis, setTargetAnalysis] = useState(analyzeTargetAddress(target));
  const [storageEst, setStorageEst] = useState({ usage: 0, quota: 0 });
  
  // Configuration
  const [storeAll, setStoreAll] = useState(true); // Default Active
  const [depth, setDepth] = useState(5); // Internal Path Depth

  // Neural Engine State
  const [resumeData, setResumeData] = useState<MiningSession | null>(null);
  const [entropyBias, setEntropyBias] = useState(0.5); 
  const [bestDist, setBestDist] = useState(1000);
  const [correlations, setCorrelations] = useState<any[]>([]);
    const [optSuggestion, setOptSuggestion] = useState<any | null>(null);
    const [powerMode, setPowerMode] = useState<'balanced' | 'performance'>('balanced');

  const startTimeRef = useRef<number>(0);
  const hashCountRef = useRef<number>(0);

  const log = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 50)]);
  };

  useEffect(() => {
    setTargetAnalysis(analyzeTargetAddress(target));
    if (target && target.length === 42) {
          getSession(target).then(session => {
              if (session) {
                  setResumeData(session);
                  setEntropyBias(session.entropyBias);
                  log(`Found previous session! ${session.iterations.toLocaleString()} iterations.`);
              } else {
                  setResumeData(null);
              }
          });
      }
  }, [target]);

  // Storage Estimation
  useEffect(() => {
      if (navigator.storage && navigator.storage.estimate) {
          navigator.storage.estimate().then(est => {
              setStorageEst({
                  usage: est.usage || 0,
                  quota: est.quota || 0
              });
          });
      }
  }, [stats.dbCount]);

  // --- NATIVE BRIDGE SETUP ---
  useEffect(() => {
    if (!window.electron) {
        log("ERROR: Native Bridge not found. Are you running in Electron?");
        return;
    }

    window.electron.onMinerUpdate(async (msg) => {
        const { type, payload } = msg;
        
        if (type === 'STATS') {
            hashCountRef.current += payload.hashes;
        } else if (type === 'FOUND') {
            log('CRITICAL: MATCH FOUND!');
            // Stop mining (terminate workers) immediately
            try {
                window.electron.stopMining();
            } catch (e) {}
            setRunning(false);
            try {
                const res = await window.electron.exportFound(payload);
                if (res && res.path) {
                    log(`Exported FOUND data to ${res.path}`);
                } else if (res && res.error) {
                    log(`Export failed: ${res.error}`);
                }
            } catch (e) {
                log(`Export exception: ${String(e)}`);
            }
            alert(`FOUND: ${payload.privateKey}\nAddress: ${payload.address}`);
        } else if (type === 'SAMPLE') {
            // Persist sample for learning/lookup
            try {
                if (storeAll) {
                    const sample = payload;
                    const newKey = {
                        mnemonic: sample.mnemonic || '',
                        privateKey: sample.privateKey?.startsWith('0x') ? sample.privateKey : `0x${sample.privateKey}`,
                        address: sample.address,
                        network: network,
                        timestamp: sample.timestamp || Date.now()
                    };
                    saveKey(newKey).then(() => {
                        getDbStats().then(c => setStats(s => ({ ...s, dbCount: c })));
                    });
                }
            } catch (e) {
                log(`Failed saving sample: ${String(e)}`);
            }
        } else if (type === 'LEARNING') {
            // Update UI with learning insights
            if (payload && payload.ngrams) {
                const items: any[] = [];
                if (payload.ngrams.bigrams) {
                    payload.ngrams.bigrams.forEach((b: string, i: number) => items.push({ wordProxy: b, addrPrefix: '', count: 1 }));
                }
                setCorrelations(items);
            }
        } else if (type === 'LOG') {
            log(payload);
        } else if (type === 'CHECKPOINT') {
            if (payload.entropyBias) setEntropyBias(payload.entropyBias);
            if (payload.bestDistance) setBestDist(payload.bestDistance);
            if (payload.topPatterns) setCorrelations(payload.topPatterns);

            const sessionData: MiningSession = {
                targetAddress: target,
                lastUpdated: Date.now(),
                entropyBias: payload.entropyBias,
                rewards12: payload.rewards12,
                rewards24: payload.rewards24,
                bestHammingDistance: payload.bestDistance || 1000,
                iterations: payload.totalPatternsAnalyzed || hashCountRef.current
            };
            saveSession(sessionData);
        }
    });

    window.electron.onSystemStatus((msg) => {
        if (msg.status === 'RUNNING') {
            log(`Native Engine Active: ${msg.threads} Kernels`);
        } else {
            log('Native Engine Stopped');
        }
    });

    getDbStats().then(c => setStats(s => ({...s, dbCount: c})));

    return () => {
        if (window.electron) window.electron.removeListeners();
    };
  }, [target]);

    // Fetch optimization suggestion on mount
    useEffect(() => {
        (async () => {
            if (window.electron && window.electron.getOptimizationSuggestion) {
                try {
                    const s = await window.electron.getOptimizationSuggestion();
                    setOptSuggestion(s);
                    if (s && s.recommended) setPowerMode('balanced');
                } catch (e) { /* ignore */ }
            }
        })();
    }, []);

  // Hardware Monitor Loop
  useEffect(() => {
      const interval = setInterval(async () => {
          if (window.electron) {
            const hStats = await window.electron.getHardwareStats();
                        setHwStats({ ram: hStats.ramUsage, load: hStats.load, temp: hStats.cpuTemp });
                        // If main process returned disk usage for APP_ROOT, use it for storage monitor
                        try {
                            if (hStats.disk && typeof hStats.disk.total === 'number') {
                                setStorageEst({ usage: hStats.disk.used || 0, quota: hStats.disk.total || 0 });
                            }
                        } catch (e) { /* ignore */ }
          }
          
          if(running) {
             const elapsed = (Date.now() - startTimeRef.current) / 1000;
             setStats(prev => ({
                 ...prev,
                 totalHashes: hashCountRef.current,
                 speed: hashCountRef.current / (elapsed || 1)
             }));
          }
      }, 1000);
      return () => clearInterval(interval);
  }, [running]);

  const startMining = (resume: boolean) => {
    if (targetAnalysis.score === 0) {
        log('Aborting: Invalid Target Address');
        return;
    }
    setRunning(true);
    startTimeRef.current = Date.now();
    hashCountRef.current = resume && resumeData ? resumeData.iterations : 0;
    
    const config = {
        targetAddress: target,
        network: network,
        entropyBias: resume && resumeData ? resumeData.entropyBias : 0.5,
        resumeData: resume ? resumeData : null,
        derivationDepth: depth,
        storeAll: storeAll
    };

    window.electron.startMining(config);
    log(resume ? "Resuming heuristic session..." : "Starting new mining session...");
  };

  const stopMining = () => {
    window.electron.stopMining();
    setRunning(false);
  };

  const handleImportLegacy = async () => {
      log("Opening file dialog for legacy import...");
      const data = await window.electron.importLegacyData();
      if (data) {
          log(`Importing ${data.length} entries...`);
          const count = await importDatabaseData(data);
          const newCount = await getDbStats();
          setStats(s => ({...s, dbCount: newCount}));
          log(`Successfully imported ${count} legacy keys.`);
      }
  };

  const formatBytes = (bytes: number) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen text-slate-300 p-6 max-w-7xl mx-auto flex flex-col gap-6 font-sans">
      
      {/* Header */}
      <header className="flex justify-between items-center pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Cpu className="text-indigo-500" /> 
            Artemis <span className="text-indigo-400 font-light">Native 2.0</span>
          </h1>
          <p className="text-slate-500 mt-1">Windows Kernel • C++ Logic • Node.js Threads</p>
        </div>
        
        <div className="flex gap-6 items-center">
             {/* Hardware Monitor */}
             <div className="flex gap-4 text-xs font-mono">
                <div className="flex flex-col items-end">
                    <span className="text-slate-500 uppercase font-bold">CPU Load</span>
                    <span className={hwStats.load > 80 ? "text-amber-400" : "text-emerald-400"}>{hwStats.load.toFixed(0)}%</span>
                </div>
                <div className="flex flex-col items-end">
                    <span className="text-slate-500 uppercase font-bold">RAM</span>
                    <span className="text-indigo-400">{hwStats.ram.toFixed(1)}%</span>
                </div>
                 <div className="flex flex-col items-end">
                    <span className="text-slate-500 uppercase font-bold">Temp</span>
                    <span className="text-rose-400">{hwStats.temp > 0 ? hwStats.temp + '°C' : 'N/A'}</span>
                </div>
            </div>

            <div className="h-8 w-px bg-slate-800"></div>

            {/* Stats Header */}
            <div className="flex flex-col items-end px-2">
                <span className="text-[10px] uppercase text-slate-500 font-bold">Native Speed</span>
                <span className="text-xl font-mono text-white font-bold">{(stats.speed / 1000).toFixed(2)} kH/s</span>
            </div>
            <div className="flex flex-col items-end px-2">
                 <span className="text-[10px] uppercase text-slate-500 font-bold">Total Checked</span>
                 <span className="text-xl font-mono text-emerald-400 font-bold">{(stats.totalHashes / 1000000).toFixed(4)} M</span>
            </div>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6">
        
        {/* Left Col: Config & Control */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
            
            {/* Target Configuration */}
            <div className="glass-panel p-5 rounded-xl space-y-4">
                <h3 className="text-white font-bold flex items-center gap-2 border-b border-slate-700/50 pb-2">
                    <Target size={16} className="text-indigo-500" /> Target Configuration
                </h3>
                
                {/* Network Selector */}
                <div>
                     <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Network</label>
                     <div className="grid grid-cols-3 gap-2">
                        {[NetworkType.ETHEREUM, NetworkType.BSC, NetworkType.POLYGON].map(n => (
                            <button 
                                key={n}
                                onClick={() => setNetwork(n)}
                                className={`text-xs font-bold py-2 rounded transition-all ${network === n ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}
                            >
                                {n}
                            </button>
                        ))}
                     </div>
                </div>

                {/* Target Input */}
                <div>
                     <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Target Address</label>
                    <div className="flex gap-2">
                      <input 
                        className={`w-full bg-slate-950 border ${targetAnalysis.score < 50 ? 'border-red-900' : 'border-slate-700'} p-3 rounded text-white font-mono text-sm focus:border-indigo-500 outline-none transition-colors`}
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        disabled={running}
                        placeholder="0x..."
                    />
                      <button onClick={async () => {
                          try {
                              const clip = await window.electron.readClipboard();
                              if (clip) setTarget(clip.trim());
                          } catch (e) { log('Clipboard paste failed'); }
                      }} className="px-3 py-2 bg-slate-800 rounded text-slate-300 text-xs">Paste</button>
                    </div>
                     {/* Analysis Badge */}
                     <div className={`text-[10px] mt-2 p-2 rounded flex justify-between items-center ${
                        targetAnalysis.label === 'Hardened' ? 'bg-emerald-900/20 text-emerald-400' : 
                        targetAnalysis.label === 'Critical' ? 'bg-red-900/20 text-red-400' : 'bg-slate-800 text-slate-400'
                    }`}>
                        <span className="flex items-center gap-1"><ShieldAlert size={12}/> {targetAnalysis.label}</span>
                        <span>Diff: {targetAnalysis.derivationDifficulty}</span>
                    </div>
                </div>

                {/* Derivation Depth Slider */}
                <div>
                    <label className="flex justify-between text-xs font-bold text-slate-500 uppercase mb-1">
                        <span>Internal Path Depth</span>
                        <span className="text-white">{depth} Accounts</span>
                    </label>
                    <input 
                        type="range" min="1" max="10" step="1"
                        value={depth}
                        onChange={(e) => setDepth(Number(e.target.value))}
                        disabled={running}
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="text-[10px] text-slate-500 mt-1">Checks m/44'/60'/0'/0/0 to {depth-1}</div>
                </div>

                 {/* Store All Checkbox */}
                 <div className="pt-2">
                    <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                            type="checkbox" 
                            checked={storeAll}
                            onChange={(e) => setStoreAll(e.target.checked)}
                            disabled={running}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900 checked:bg-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                            Archive all attempts <span className="text-xs text-slate-600 ml-1">(Active by default)</span>
                        </span>
                    </label>
                </div>

                {/* Controls */}
                <div className="pt-2">
                    {!running ? (
                        <div className="grid grid-cols-2 gap-3">
                            {resumeData && (
                                <button onClick={() => startMining(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all">
                                    <RotateCcw size={18} /> Resume
                                </button>
                            )}
                            <button onClick={() => startMining(false)} className={`bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 transition-all ${!resumeData ? 'col-span-2' : ''}`}>
                                <Play size={18} /> {resumeData ? 'New Session' : 'Initialize Kernel'}
                            </button>
                        </div>
                    ) : (
                        <button onClick={stopMining} className="w-full bg-rose-600 hover:bg-rose-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-rose-900/20 transition-all">
                            <Square size={18} /> Terminate Process
                        </button>
                    )}
                                        <div className="mt-3 flex gap-2">
                                            <button onClick={async () => {
                                                // Simulate a FOUND locally (for testing): construct payload and run export logic
                                                const payload = {
                                                    mnemonic: 'test mnemonic example',
                                                    privateKey: '0x' + 'ab'.repeat(32),
                                                    address: target
                                                } as any;
                                                // Reuse renderer's FOUND handling by invoking same code path
                                                try {
                                                    // stop mining
                                                    window.electron.stopMining();
                                                } catch (e) {}
                                                setRunning(false);
                                                try {
                                                    const res = await window.electron.exportFound(payload);
                                                    if (res && res.path) log(`Exported (simulated) to ${res.path}`);
                                                } catch (e) { log(`Simulated export failed: ${String(e)}`); }
                                                alert(`Simulated FOUND: ${payload.privateKey}\nAddress: ${payload.address}`);
                                            }} className="text-xs bg-slate-800 px-3 py-2 rounded text-slate-300">Simulate FOUND</button>
                                        </div>
                </div>

                                {/* Hardware Optimization */}
                                <div className="mt-4 border-t border-slate-800 pt-4">
                                    <h4 className="text-sm font-bold text-slate-300 mb-2">Performance</h4>
                                    <div className="flex items-center gap-2">
                                        <button onClick={async () => {
                                                if (!window.electron || !window.electron.setPowerMode) return;
                                                try {
                                                    const res = await window.electron.setPowerMode('balanced');
                                                    if (res && res.ok) {
                                                        setPowerMode('balanced');
                                                        log(`Set power mode: balanced (${res.threads} threads)`);
                                                    }
                                                } catch (e) { log(`Failed to set balanced mode: ${String(e)}`); }
                                            }}
                                            className={`px-3 py-2 rounded ${powerMode === 'balanced' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                                            Balanced (~75%)
                                        </button>

                                        <button onClick={async () => {
                                                if (!window.electron || !window.electron.setPowerMode) return;
                                                try {
                                                    const res = await window.electron.setPowerMode('performance');
                                                    if (res && res.ok) {
                                                        setPowerMode('performance');
                                                        log(`Set power mode: performance (${res.threads} threads)`);
                                                    }
                                                } catch (e) { log(`Failed to set performance mode: ${String(e)}`); }
                                            }}
                                            className={`px-3 py-2 rounded ${powerMode === 'performance' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                                            Performance (100%)
                                        </button>

                                        <div className="text-xs text-slate-500 ml-3">
                                            {optSuggestion ? `${optSuggestion.detected.cpuModel} • ${optSuggestion.detected.cores} cores • ${optSuggestion.detected.totalMemGB}GB` : 'Detecting hardware...'}
                                        </div>
                                    </div>
                                </div>
            </div>

            {/* Database Actions */}
            <div className="glass-panel p-5 rounded-xl space-y-3">
                <h3 className="text-white font-bold flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2"><Database size={16} /> Storage Monitor</span>
                    <span className="text-xs font-mono text-slate-500">
                         {formatBytes(storageEst.usage)} / {formatBytes(storageEst.quota)}
                    </span>
                </h3>
                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                     <div className="bg-indigo-500 h-full" style={{ width: `${Math.min(100, (storageEst.usage / storageEst.quota) * 100)}%` }}></div>
                </div>
                
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <button onClick={handleImportLegacy} className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded text-xs font-bold flex items-center justify-center gap-2 transition-colors">
                        <Upload size={14} /> Import Legacy
                    </button>
                    <button onClick={() => { clearDatabase(); setStats(s => ({...s, dbCount: 0}))}} className="bg-slate-800 hover:bg-rose-900/30 text-rose-400 py-2 rounded text-xs font-bold flex items-center justify-center gap-2 transition-colors">
                        <Trash2 size={14} /> Purge DB
                    </button>
                </div>
            </div>
        </div>

        {/* Right Col: Heuristics & Visuals */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
            
            {/* Neural Heuristic Engine Panel */}
            <div className="glass-panel p-6 rounded-xl flex flex-col h-[380px]">
                 <h3 className="text-white font-bold mb-6 flex items-center justify-between">
                    <span className="flex items-center gap-2"><Activity className="text-emerald-400" /> Neural Heuristic Engine</span>
                                        <div className="flex items-center gap-2">
                                            <button onClick={async () => {
                                                try {
                                                    const clip = await window.electron.readClipboard();
                                                    if (clip) setTarget(clip.trim());
                                                } catch (e) { log('Clipboard paste failed'); }
                                            }} className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-300">Paste Target</button>
                                            {resumeData && <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-400">Session Loaded</span>}
                                        </div>
                 </h3>
                 
                 <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: Metrics */}
                    <div className="space-y-6">
                        {/* Proximity Gauge */}
                        <div className="bg-slate-900/50 rounded-xl p-4 flex flex-col items-center justify-center border border-slate-800 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-indigo-500"></div>
                            <div className="text-5xl font-mono font-bold text-white mb-2 tracking-tighter">{bestDist}</div>
                            <div className="text-xs uppercase text-slate-500 font-bold tracking-wider">Best Hamming Distance</div>
                            <div className="text-[10px] text-slate-600 mt-1">Optimization Target: 0</div>
                            <div className="w-full mt-4">
                                {/* Simple Hamming distance bar: 0 = perfect (full), 20+ = empty */}
                                {(() => {
                                    const maxBytes = 20;
                                    const capped = Math.min(Math.max(bestDist, 0), maxBytes);
                                    const filledPerc = Math.round(((maxBytes - capped) / maxBytes) * 100);
                                    return (
                                        <div className="space-y-2">
                                            <div className="w-full h-3 bg-slate-800 rounded overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-emerald-400 to-indigo-500" style={{ width: `${filledPerc}%` }}></div>
                                            </div>
                                            <div className="flex justify-between text-[10px] text-slate-500">
                                                <span>Proximity</span>
                                                <span>{capped} / {maxBytes} bytes</span>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                         {/* RL Bias Viz */}
                        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                            <div className="flex justify-between items-end mb-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">Entropy Strategy (RL)</span>
                                <span className="text-sm font-mono text-indigo-400">{(entropyBias * 100).toFixed(1)}% Bias</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-600 mb-1">
                                <span>Favor 128-bit</span>
                                <span>Favor 256-bit</span>
                            </div>
                            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-500" style={{ width: `${entropyBias * 100}%` }}></div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Right: Pattern Correlations */}
                    <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 overflow-hidden flex flex-col">
                         <div className="text-xs uppercase text-slate-500 font-bold mb-3 flex items-center gap-2">
                             <Share2 size={12} /> Pattern Correlations (Brain)
                         </div>
                         <div className="flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                             {correlations.length > 0 ? correlations.map((c, i) => (
                                 <div key={i} className="flex justify-between items-center text-xs font-mono p-2 rounded hover:bg-slate-800/50 transition-colors">
                                     <div className="flex items-center gap-2">
                                         <span className="w-2 h-2 rounded-full bg-indigo-500/50"></span>
                                         <span className="text-slate-300">Entropy {c.wordProxy}</span>
                                     </div>
                                     <div className="flex items-center gap-2">
                                         <span className="text-slate-500">→</span>
                                         <span className="text-emerald-400">{c.addrPrefix}</span>
                                     </div>
                                     <span className="text-slate-600 bg-slate-950 px-1 rounded">x{c.count}</span>
                                 </div>
                             )) : (
                                 <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs italic">
                                     <Activity className="mb-2 opacity-20" size={24}/>
                                     Collecting neural samples...
                                 </div>
                             )}
                         </div>
                    </div>
                 </div>
            </div>

            {/* System Log */}
            <div className="glass-panel p-4 rounded-xl h-48 overflow-hidden flex flex-col">
                 <div className="flex items-center gap-2 mb-2 text-slate-500 text-xs font-bold uppercase border-b border-slate-800 pb-2">
                    <Terminal size={12} /> Native Kernel Log
                 </div>
                 <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1 custom-scrollbar pr-2">
                     {logs.map((l, i) => (
                         <div key={i} className="text-slate-400 border-l-2 border-slate-800 pl-2 py-0.5 hover:bg-slate-800/30 transition-colors">{l}</div>
                     ))}
                     {logs.length === 0 && <span className="text-slate-700 italic">System Ready. Waiting for initialization...</span>}
                 </div>
            </div>
        </div>
      </div>
    </div>
  );
}
