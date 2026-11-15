import { RideEvent, SamplesBatch } from '../api/rides.models';

/** A request waiting to reach the backend. Kept in order; `key` is assigned by the store. */
export type QueuedItem =
  | { key?: number; rideId: string; kind: 'samples'; body: SamplesBatch }
  | { key?: number; rideId: string; kind: 'events'; body: RideEvent[] }
  | { key?: number; rideId: string; kind: 'complete' };

export interface QueueStore {
  add(item: QueuedItem): Promise<void>;
  /** Oldest first. */
  all(): Promise<QueuedItem[]>;
  remove(key: number): Promise<void>;
}

/** In-memory store: used when IndexedDB is unavailable (private mode, tests). */
export class MemoryQueueStore implements QueueStore {
  private items: QueuedItem[] = [];
  private next = 1;

  async add(item: QueuedItem): Promise<void> {
    this.items.push({ ...item, key: this.next++ });
  }

  async all(): Promise<QueuedItem[]> {
    return [...this.items];
  }

  async remove(key: number): Promise<void> {
    this.items = this.items.filter((i) => i.key !== key);
  }
}

const DB = 'zwiftfree';
const STORE = 'ride-queue';

/** IndexedDB store, so samples recorded while offline survive a reload or a closed tab. */
export class IndexedDbQueueStore implements QueueStore {
  private db: Promise<IDBDatabase> | null = null;

  static available(): boolean {
    try {
      return typeof indexedDB !== 'undefined';
    } catch {
      return false;
    }
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async add(item: QueuedItem): Promise<void> {
    const { key: _ignored, ...rest } = item;
    void _ignored;
    await this.tx('readwrite', (s) => s.add(rest));
  }

  async all(): Promise<QueuedItem[]> {
    return this.tx('readonly', (s) => s.getAll() as IDBRequest<QueuedItem[]>);
  }

  async remove(key: number): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key));
  }
}
