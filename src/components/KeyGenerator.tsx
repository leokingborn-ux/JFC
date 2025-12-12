
import React, { useState } from 'react';
import { ethers } from 'ethers';
import { NetworkType, KeyPair } from '../types';
import { calculateEntropyScore } from '../services/analysis';
import { RefreshCw, ShieldCheck, Cpu, Copy, Check, Settings2 } from 'lucide-react';

export default function KeyGenerator() {
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [entropyScore, setEntropyScore] = useState<number>(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState<12 | 24>(24);

  const generateIdentity = () => {
    // Generate explicit entropy based on user selection (16 bytes = 128 bits = 12 words, 32 bytes = 256 bits = 24 words)
    const bytes = wordCount === 24 ? 32 : 16;
    const entropy = ethers.randomBytes(bytes);
    const mnemonic = ethers.Mnemonic.fromEntropy(entropy);
    const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic);
    
    const newKey: KeyPair = {
        mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : "Error: No Mnemonic",
        privateKey: wallet.privateKey,
        address: wallet.address,
        network: NetworkType.ETHEREUM,
        timestamp: Date.now()
    };

    setKeyPair(newKey);
    // Remove '0x' for entropy calculation
    setEntropyScore(calculateEntropyScore(newKey.privateKey.substring(2)));
  };

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto text-slate-300 p-6">
       <div className="mb-8 border-b border-slate-800 pb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <ShieldCheck className="text-emerald-500" />
            Manual Identity Generator
          </h2>
          <p className="text-slate-500 mt-2">
            Generate cryptographically secure single-use identities locally using the Ethers.js library (BIP-39 Standard). 
            No external APIs or AI involved.
          </p>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Controls */}
          <div className="space-y-6">
             <div className="glass-panel p-6 rounded-xl space-y-4">
                <div className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Settings2 size={14} /> Configuration
                </div>
                
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Network</label>
                    <select className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500">
                        <option value="ETH">Ethereum (ERC-20)</option>
                        <option value="BTC" disabled>Bitcoin (Not implemented in local build)</option>
                    </select>
                </div>

                <div>
                    <label className="block text-xs text-slate-400 mb-2">Entropy Strength</label>
                    <div className="grid grid-cols-2 gap-3">
                        <button 
                            onClick={() => setWordCount(12)}
                            className={`py-2 px-3 rounded-lg text-sm font-medium transition-all border ${
                                wordCount === 12 
                                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' 
                                : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600'
                            }`}
                        >
                            12 Words (128-bit)
                        </button>
                        <button 
                             onClick={() => setWordCount(24)}
                             className={`py-2 px-3 rounded-lg text-sm font-medium transition-all border ${
                                wordCount === 24 
                                ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300' 
                                : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600'
                            }`}
                        >
                            24 Words (256-bit)
                        </button>
                    </div>
                </div>

                <button 
                    onClick={generateIdentity}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 rounded-lg shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
                >
                    <RefreshCw size={20} /> Generate New Identity
                </button>
             </div>

             {keyPair && (
                 <div className="glass-panel p-6 rounded-xl border-l-4 border-indigo-500">
                    <div className="text-sm font-bold text-slate-500 uppercase mb-2">Entropy Analysis</div>
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-3xl font-mono font-bold text-white">{entropyScore.toFixed(1)}%</span>
                        <span className="text-xs text-emerald-400 mb-1">Strong Randomness</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${entropyScore}%` }}></div>
                    </div>
                 </div>
             )}
          </div>

          {/* Results */}
          <div className="space-y-4">
            {!keyPair ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl min-h-[300px]">
                    <Cpu size={48} className="mb-4 opacity-20" />
                    <p>Awaiting generation command...</p>
                </div>
            ) : (
                <>
                    {/* Address */}
                    <div className="glass-panel p-4 rounded-xl group relative">
                        <label className="text-xs font-bold text-indigo-400 uppercase mb-1 block">Public Address</label>
                        <div className="font-mono text-sm text-white break-all">{keyPair.address}</div>
                        <button 
                            onClick={() => copyToClipboard(keyPair.address, 'addr')}
                            className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                        >
                            {copied === 'addr' ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                    </div>

                    {/* Private Key */}
                    <div className="glass-panel p-4 rounded-xl group relative border border-rose-900/30 bg-rose-950/10">
                        <label className="text-xs font-bold text-rose-400 uppercase mb-1 block flex items-center gap-2">
                            Private Key <span className="px-1.5 py-0.5 rounded bg-rose-900/50 text-[10px]">SENSITIVE</span>
                        </label>
                        <div className="font-mono text-sm text-rose-200 break-all blur-[4px] hover:blur-0 transition-all duration-300">
                            {keyPair.privateKey}
                        </div>
                        <button 
                            onClick={() => copyToClipboard(keyPair.privateKey, 'pk')}
                            className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                        >
                             {copied === 'pk' ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                    </div>

                    {/* Mnemonic */}
                    <div className="glass-panel p-4 rounded-xl group relative">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1 flex items-center gap-2">
                            Mnemonic Phrase
                            <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 rounded">{wordCount} Words</span>
                        </label>
                        <div className="font-mono text-sm text-slate-300 break-words leading-relaxed mt-2">
                            {keyPair.mnemonic}
                        </div>
                        <button 
                            onClick={() => copyToClipboard(keyPair.mnemonic, 'phrase')}
                            className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                        >
                             {copied === 'phrase' ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                    </div>
                </>
            )}
          </div>
       </div>
    </div>
  );
}
