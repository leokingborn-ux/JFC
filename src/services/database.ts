import Dexie, { Table } from 'dexie';
import { GeneratedKey, DbStat, MiningSession } from '../types';

// If preload exposed an IPC-backed DB, use it. Otherwise fallback to Dexie in-renderer.
const hasIpcDb = typeof (window as any).electron?.db === 'object';

let dexieDb: Dexie | null = null;
let dexieKeys: Table<GeneratedKey> | null = null;
let dexieSessions: Table<MiningSession> | null = null;

if (!hasIpcDb) {
  class KeyDatabase extends Dexie {
    keys!: Table<GeneratedKey>;
    stats!: Table<DbStat>;
    sessions!: Table<MiningSession>;

    constructor() {
      super('EntropyZeroDB');
      (this as any).version(2).stores({
        keys: '++id, address, network, timestamp',
        stats: '++id, totalAttempts',
        sessions: 'targetAddress, lastUpdated'
      });
    }
  }
  const kdb = new KeyDatabase();
  dexieDb = kdb as unknown as Dexie;
  dexieKeys = (kdb as any).keys;
  dexieSessions = (kdb as any).sessions;
}

export const saveKey = async (key: GeneratedKey) => {
  if (hasIpcDb) {
    try { await (window as any).electron.db.saveKey(key); } catch (e) { console.error('IPC saveKey failed', e); }
    return;
  }
  try {
    await dexieKeys!.add(key);
  } catch (error) {
    // ignore duplicates
  }
};

export const saveKeyBatch = async (keys: GeneratedKey[]) => {
  if (hasIpcDb) {
    try { await (window as any).electron.db.saveKeys(keys); } catch (e) { console.error('IPC saveKeyBatch failed', e); }
    return;
  }
  try { await dexieKeys!.bulkAdd(keys); } catch (e) { console.error('Batch save failed', e); }
};

export const getDbStats = async () => {
  if (hasIpcDb) {
    try { const res = await (window as any).electron.db.getKeys(); return Array.isArray(res?.rows) ? res.rows.length : 0; } catch (e) { return 0; }
  }
  const count = await dexieKeys!.count();
  return count;
};

// --- SESSION MANAGEMENT ---

export const saveSession = async (session: MiningSession) => {
  if (hasIpcDb) {
    try { await (window as any).electron.db.saveSession(session.targetAddress, session); } catch (e) { console.error('IPC saveSession failed', e); }
    return;
  }
  try { await dexieSessions!.put(session); } catch (e) { console.error('Failed to save session', e); }
};

export const getSession = async (targetAddress: string): Promise<MiningSession | undefined | null> => {
  if (hasIpcDb) {
    try { const r = await (window as any).electron.db.getSession(targetAddress); return r && r.session ? r.session : null; } catch (e) { return null; }
  }
  try { return await dexieSessions!.get(targetAddress); } catch (e) { return undefined; }
};

// --- LEGACY DATA IMPORT ---
export const importDatabaseData = async (data: GeneratedKey[]) => {
  if (!Array.isArray(data)) return 0;
  if (hasIpcDb) {
    try { await (window as any).electron.db.saveKeys(data); return data.length; } catch (e) { console.error('IPC import failed', e); return 0; }
  }
  try { await dexieKeys!.bulkAdd(data); return data.length; } catch (e) { console.error('Database Import Error', e); return 0; }
};

export const clearDatabase = async () => {
  if (hasIpcDb) {
    // Not implemented for IPC path (could add handler if needed)
    console.warn('clearDatabase not implemented for IPC DB');
    return;
  }
  await dexieKeys!.clear();
  await dexieSessions!.clear();
};