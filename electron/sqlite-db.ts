import * as path from 'path';
import * as fs from 'fs';

type KeyRow = {
  id?: number;
  mnemonic?: string;
  privateKey?: string;
  address?: string;
  network?: string;
  timestamp?: number;
};

/**
 * SqliteDB - uses `sql.js` (pure JS/wasm) if available, otherwise falls back to
 * `better-sqlite3` if present, otherwise uses a safe JSON file fallback.
 *
 * Methods are synchronous after `init()` completes. Call `await init()` during
 * main startup before handling IPC DB requests.
 */
export class SqliteDB {
  dbPath: string;
  useSqlite = false; // true when using an actual sqlite backend (sql.js or better-sqlite3)
  driver: 'sqljs' | 'better' | 'json' = 'json';
  // runtime handles
  SQL: any = null;
  db: any = null;

  constructor(dbFile: string) {
    this.dbPath = dbFile;
  }

  async init(): Promise<void> {
    // Ensure folder exists
    try { const dir = path.dirname(this.dbPath); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }

    // First try sql.js (pure JS/wasm)
    try {
      // Dynamically require so package is optional
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const initSqlJs = require('sql.js');
      // initSqlJs may be a function or an object with default
      const initFn = typeof initSqlJs === 'function' ? initSqlJs : initSqlJs.default || initSqlJs;
      const SQL = await initFn({ locateFile: (file: string) => {
        try { return require.resolve('sql.js/dist/' + file); } catch (_) { return path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file); }
      }});
      this.SQL = SQL;

      // If DB file exists, load it; else create new DB
      if (fs.existsSync(this.dbPath)) {
        const buf = fs.readFileSync(this.dbPath);
        const u8 = new Uint8Array(buf);
        this.db = new SQL.Database(u8);
      } else {
        this.db = new SQL.Database();
        this.persist();
      }

      this.driver = 'sqljs';
      this.useSqlite = true;
      this.initTablesSqljs();
      return;
    } catch (e) {
      // continue to try better-sqlite3
    }

    // Try native better-sqlite3 (may fail on systems without native build)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const BetterSqlite3 = require('better-sqlite3');
      this.db = new BetterSqlite3(this.dbPath);
      this.driver = 'better';
      this.useSqlite = true;
      this.initTablesBetter();
      return;
    } catch (e) {
      // fallback to JSON
    }

    // JSON fallback
    this.driver = 'json';
    this.useSqlite = false;
    if (!fs.existsSync(this.dbPath)) fs.writeFileSync(this.dbPath, JSON.stringify({ keys: [], sessions: {} }), 'utf8');
  }

  initTablesSqljs() {
    try {
      // Create tables if not exist
      this.db.run(`CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mnemonic TEXT,
        privateKey TEXT,
        address TEXT UNIQUE,
        network TEXT,
        timestamp INTEGER
      )`);

      this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
        target TEXT PRIMARY KEY,
        payload TEXT,
        lastUpdated INTEGER
      )`);
      this.persist();
    } catch (e) { /* ignore */ }
  }

  initTablesBetter() {
    try {
      this.db.prepare(`CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mnemonic TEXT,
        privateKey TEXT,
        address TEXT UNIQUE,
        network TEXT,
        timestamp INTEGER
      )`).run();

      this.db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        target TEXT PRIMARY KEY,
        payload TEXT,
        lastUpdated INTEGER
      )`).run();
    } catch (e) { /* ignore */ }
  }

  // Persist SQL.js memory DB to file
  persist() {
    if (this.driver !== 'sqljs' || !this.SQL || !this.db) return;
    try {
      const data = this.db.export();
      const buf = Buffer.from(data);
      const tmp = this.dbPath + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, this.dbPath);
    } catch (e) {
      console.error('sqljs persist failed', (e as any)?.message);
    }
  }

  saveKey(key: KeyRow) {
    if (this.useSqlite && this.driver === 'sqljs' && this.db) {
      try {
        const ts = key.timestamp || Date.now();
        const stmt = this.db.prepare('INSERT OR IGNORE INTO keys (mnemonic, privateKey, address, network, timestamp) VALUES (?, ?, ?, ?, ?)');
        stmt.run([key.mnemonic || null, key.privateKey || null, key.address || null, key.network || null, ts]);
        this.persist();
        return true;
      } catch (e) { console.error('sqljs saveKey failed', (e as any)?.message); return false; }
    }

    if (this.useSqlite && this.driver === 'better' && this.db) {
      try {
        const stmt = this.db.prepare(`INSERT OR IGNORE INTO keys (mnemonic, privateKey, address, network, timestamp) VALUES (?, ?, ?, ?, ?)`);
        stmt.run(key.mnemonic || null, key.privateKey || null, key.address || null, key.network || null, key.timestamp || Date.now());
        return true;
      } catch (e) { console.error('saveKey failed', (e as any)?.message); return false; }
    }

    // JSON fallback
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf8');
      const obj = JSON.parse(raw || '{}');
      obj.keys = obj.keys || [];
      if (!obj.keys.find((k: any) => k.address === key.address)) {
        obj.keys.push(key);
        const tmp = this.dbPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(obj));
        fs.renameSync(tmp, this.dbPath);
      }
      return true;
    } catch (e) { console.error('JSON saveKey failed', (e as any)?.message); return false; }
  }

  saveKeyBatch(keys: KeyRow[]) {
    if (this.useSqlite && this.driver === 'sqljs' && this.db) {
      try {
        const insert = this.db.prepare('INSERT OR IGNORE INTO keys (mnemonic, privateKey, address, network, timestamp) VALUES (?, ?, ?, ?, ?)');
        this.db.run('BEGIN');
        for (const r of keys) insert.run([r.mnemonic || null, r.privateKey || null, r.address || null, r.network || null, r.timestamp || Date.now()]);
        this.db.run('COMMIT');
        this.persist();
        return true;
      } catch (e) { try { this.db.run('ROLLBACK'); } catch (_) {} console.error('sqljs batch insert failed', (e as any)?.message); return false; }
    }

    if (this.useSqlite && this.driver === 'better' && this.db) {
      const insert = this.db.prepare(`INSERT OR IGNORE INTO keys (mnemonic, privateKey, address, network, timestamp) VALUES (?, ?, ?, ?, ?)`);
      const trans = this.db.transaction((rows: KeyRow[]) => {
        for (const r of rows) insert.run(r.mnemonic || null, r.privateKey || null, r.address || null, r.network || null, r.timestamp || Date.now());
      });
      try { trans(keys); return true; } catch (e) { console.error('batch insert failed', (e as any)?.message); return false; }
    }

    try {
      const raw = fs.readFileSync(this.dbPath, 'utf8');
      const obj = JSON.parse(raw || '{}');
      obj.keys = obj.keys || [];
      for (const k of keys) if (!obj.keys.find((x: any) => x.address === k.address)) obj.keys.push(k);
      const tmp = this.dbPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, this.dbPath);
      return true;
    } catch (e) { console.error('JSON batch save failed', (e as any)?.message); return false; }
  }

  getKeys() {
    if (this.useSqlite && this.driver === 'sqljs' && this.db) {
      try {
        const res = this.db.exec('SELECT id, mnemonic, privateKey, address, network, timestamp FROM keys ORDER BY timestamp DESC');
        if (!res || !res[0]) return [];
        const cols = res[0].columns;
        const values = res[0].values;
        return values.map((row: any[]) => {
          const obj: any = {};
          for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
          return obj;
        });
      } catch (e) { return []; }
    }

    if (this.useSqlite && this.driver === 'better' && this.db) {
      try { return this.db.prepare('SELECT * FROM keys ORDER BY timestamp DESC').all(); } catch (e) { return []; }
    }

    try { const obj = JSON.parse(fs.readFileSync(this.dbPath, 'utf8') || '{}'); return obj.keys || []; } catch (e) { return []; }
  }

  saveSession(target: string, payload: any) {
    if (this.useSqlite && this.driver === 'sqljs' && this.db) {
      try {
        const now = Date.now();
        const stmt = this.db.prepare('INSERT INTO sessions (target, payload, lastUpdated) VALUES (?, ?, ?) ON CONFLICT(target) DO UPDATE SET payload=excluded.payload, lastUpdated=excluded.lastUpdated');
        stmt.run([target, JSON.stringify(payload), now]);
        this.persist();
        return true;
      } catch (e) { console.error('sqljs saveSession failed', (e as any)?.message); return false; }
    }

    if (this.useSqlite && this.driver === 'better' && this.db) {
      try {
        const stmt = this.db.prepare('INSERT INTO sessions (target, payload, lastUpdated) VALUES (?, ?, ?) ON CONFLICT(target) DO UPDATE SET payload=excluded.payload, lastUpdated=excluded.lastUpdated');
        stmt.run(target, JSON.stringify(payload), Date.now());
        return true;
      } catch (e) { console.error('saveSession failed', (e as any)?.message); return false; }
    }

    try {
      const obj = JSON.parse(fs.readFileSync(this.dbPath, 'utf8') || '{}');
      obj.sessions = obj.sessions || {};
      obj.sessions[target] = { payload, lastUpdated: Date.now() };
      const tmp = this.dbPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, this.dbPath);
      return true;
    } catch (e) { console.error('JSON saveSession failed', (e as any)?.message); return false; }
  }

  getSession(target: string) {
    if (this.useSqlite && this.driver === 'sqljs' && this.db) {
      try {
        // Use prepared statement to get payload and lastUpdated
        const st = this.db.prepare('SELECT payload, lastUpdated FROM sessions WHERE target = ?');
        const got = st.get([target]);
        if (!got) return null;
        // depending on sql.js version, got may be array-like or object
        const payloadRaw = Array.isArray(got) ? got[0] : got.payload || got[0];
        const last = Array.isArray(got) ? got[1] : got.lastUpdated || got[1];
        return { payload: JSON.parse(payloadRaw || '{}'), lastUpdated: last };
      } catch (e) { return null; }
    }

    if (this.useSqlite && this.driver === 'better' && this.db) {
      try {
        const row = this.db.prepare('SELECT payload, lastUpdated FROM sessions WHERE target = ?').get(target);
        if (!row) return null;
        return { payload: JSON.parse(row.payload), lastUpdated: row.lastUpdated };
      } catch (e) { return null; }
    }

    try { const obj = JSON.parse(fs.readFileSync(this.dbPath, 'utf8') || '{}'); return obj.sessions && obj.sessions[target] ? obj.sessions[target] : null; } catch (e) { return null; }
  }
}

export default SqliteDB;
