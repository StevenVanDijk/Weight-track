import { Injectable } from '@angular/core';

const DB_NAME = 'weight-track';
const DB_VERSION = 1;
const STORE = 'kv';

@Injectable({ providedIn: 'root' })
export class DbService {
  private _db: IDBDatabase | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'k' });
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db!); };
      req.onerror   = () => reject(req.error);
    });
  }

  async read(key: string): Promise<unknown> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result?.v);
      req.onerror   = () => reject(req.error);
    });
  }

  async write(key: string, value: unknown): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put({ k: key, v: value });
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }
}
