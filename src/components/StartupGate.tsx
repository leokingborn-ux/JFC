import React, { useEffect, useState } from 'react';

export default function StartupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'no-bridge'>('loading');
  const [message, setMessage] = useState<string>('Initializing...');

  useEffect(() => {
    let mounted = true;

    const checkBridge = async () => {
      try {
        // Basic presence check
        if (!(window as any).electron) {
          if (!mounted) return;
          setStatus('no-bridge');
          setMessage('Native bridge not detected. Are you running inside the packaged Electron app?');
          return;
        }

        // Try a lightweight IPC call to verify preload is responsive
        const h = await (window as any).electron.getHardwareStats();
        if (!mounted) return;
        setStatus('ready');
        setMessage('Ready');
      } catch (e) {
        if (!mounted) return;
        setStatus('error');
        setMessage(String(e) || 'Unknown error while contacting native bridge');
      }
    };

    // Timeout fallback
    const timeout = setTimeout(() => {
      checkBridge();
    }, 50);

    checkBridge();

    return () => { mounted = false; clearTimeout(timeout); };
  }, []);

  if (status === 'ready') return <>{children}</>;

  // Loading / Error UI
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#020617] text-slate-200">
      <div className="max-w-2xl p-6 bg-slate-900/80 border border-slate-800 rounded-lg">
        <h2 className="text-lg font-bold text-white mb-2">Artemis</h2>
        <div className="text-sm text-slate-400 mb-4">{status === 'loading' ? 'Starting up...' : 'Initialization issue detected'}</div>

        {status === 'loading' && (
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></div>
            <div className="text-sm text-slate-300">Connecting to native bridge...</div>
          </div>
        )}

        {status === 'no-bridge' && (
          <div className="space-y-3">
            <div className="text-sm text-rose-400">Native bridge not found.</div>
            <div className="text-xs text-slate-400">Make sure you launched the packaged Electron app or that `preload.js` is available at: <code className="font-mono">dist-electron/preload.js</code></div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-2 bg-indigo-600 rounded text-white" onClick={() => location.reload()}>Retry</button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-3">
            <div className="text-sm text-rose-400">Error connecting to native bridge:</div>
            <pre className="text-xs font-mono text-slate-200 bg-slate-800 p-2 rounded">{message}</pre>
            <div className="text-xs text-slate-400">Check the main process console for stack traces and ensure `preload.js` path matches `main`.</div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-2 bg-indigo-600 rounded text-white" onClick={() => location.reload()}>Retry</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
