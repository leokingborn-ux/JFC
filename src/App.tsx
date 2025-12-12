import React, { useState } from 'react';
import MinerDashboard from './components/MinerDashboard';
import KeyGenerator from './components/KeyGenerator';
import { LayoutDashboard, Key } from 'lucide-react';

function App() {
  const [view, setView] = useState<'miner' | 'generator'>('miner');

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 selection:bg-indigo-500/30">
      {/* Mini Navigation Bar */}
      <nav className="border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center h-14 gap-8">
            <span className="font-bold text-indigo-500 tracking-wider flex items-center gap-2">
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
              ARTEMIS <span className="text-slate-500 text-xs font-normal">NATIVE ENGINE</span>
            </span>
            <div className="flex gap-1">
              <button 
                onClick={() => setView('miner')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  view === 'miner' 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <LayoutDashboard size={16} /> Miner Dashboard
              </button>
              <button 
                onClick={() => setView('generator')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  view === 'generator' 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <Key size={16} /> Key Generator
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="pt-4 pb-12">
        {view === 'miner' ? <MinerDashboard /> : <KeyGenerator />}
      </main>
    </div>
  );
}

export default App;