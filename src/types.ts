export enum NetworkType {
  ETHEREUM = 'ETH',
  BITCOIN = 'BTC',
  BSC = 'BSC',
  POLYGON = 'MATIC'
}

export interface GeneratedKey {
  mnemonic: string;
  privateKey: string;
  address: string;
  network: NetworkType;
  timestamp: number;
}

export type KeyPair = GeneratedKey;

export interface DbStat {
  id?: number;
  totalAttempts: number;
  startTime: number;
  patternsFound: number;
}

export interface MiningSession {
  targetAddress: string;
  lastUpdated: number;
  entropyBias: number;
  rewards12: number;
  rewards24: number;
  bestHammingDistance: number;
  iterations: number;
}

export interface LearningMetrics {
  bias: number;
  rewards12: number;
  rewards24: number;
  lastImprovement: number;
  iterations: number;
}

export interface PatternCorrelation {
  ngram: string;
  addressPatterns: Array<{ bytes: string; frequency: number; avgHamming: number }>;
  totalObservations: number;
}

// Global Electron Bridge Definition
declare global {
  interface Window {
    electron: {
      startMining: (config: any) => void;
      stopMining: () => void;
      getHardwareStats: () => Promise<any>;
      getLastSession: (target: string) => Promise<MiningSession | null>;
      exportFound: (payload: any) => Promise<{ path?: string; error?: string }>;
      readClipboard: () => Promise<string>;
      importLegacyData: () => Promise<GeneratedKey[] | null>;
      onMinerUpdate: (callback: (msg: any) => void) => void;
      onSystemStatus: (callback: (msg: any) => void) => void;
      removeListeners: () => void;
      getOptimizationSuggestion?: () => Promise<any>;
      setPowerMode?: (mode: 'balanced' | 'performance') => Promise<{ ok: boolean; threads?: number; error?: string }>;
    }
  }
}

export interface WorkerMessage {
  type: 'START' | 'STOP' | 'STATS' | 'FOUND' | 'LOG' | 'SAMPLE' | 'STORE' | 'BATCH_STORE' | 'LEARNING' | 'READY' | 'ERROR' | 'CHECKPOINT';
  payload?: any;
}