/**
 * The game library: saved game records in IndexedDB. Falls back to an
 * in-memory store when IndexedDB is unavailable (e.g. some private modes),
 * so the UI still works for the session.
 */
import type { Color } from "../engine/board.ts";
import type { GameSetup } from "../engine/game.ts";
import type { RecordResult } from "../engine/record.ts";

export interface GameRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  setup: GameSetup;
  moves: number[];
  /** Where it came from: played here, imported from SGF, or a shared link. */
  source: "played" | "imported" | "shared";
  /** For played games: the human's colour and the opponent level. */
  player?: Color;
  level?: number;
  /** Player names from SGF. */
  black?: string;
  white?: string;
  result?: RecordResult | null;
  /** Dead stones agreed at the count (vertices). */
  dead?: number[];
  /** A played game left unfinished when a new one started. */
  abandoned?: boolean;
  /** Review: Black's win rate after each ply, and the best move there. */
  review?: { black: (number | null)[]; best: (number | null)[] };
}

const DB_NAME = "go";
const STORE = "games";

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, GameRecord>();

function openDB(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" }).createIndex(
            "updatedAt",
            "updatedAt",
          );
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** True when records survive a reload (IndexedDB works). */
export async function isPersistent(): Promise<boolean> {
  return (await openDB()) !== null;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then((db) =>
    new Promise<T>((resolve, reject) => {
      if (!db) return reject(new Error("no db"));
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

export async function putRecord(rec: GameRecord): Promise<void> {
  memory.set(rec.id, rec);
  try {
    await tx("readwrite", (s) => s.put(rec));
  } catch {
    // memory fallback already holds it
  }
}

export async function getRecord(id: string): Promise<GameRecord | undefined> {
  try {
    return (await tx<GameRecord | undefined>("readonly", (s) => s.get(id))) ??
      memory.get(id);
  } catch {
    return memory.get(id);
  }
}

export async function deleteRecord(id: string): Promise<void> {
  memory.delete(id);
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    // ignore
  }
}

/** All records, most recent first. */
export async function listRecords(): Promise<GameRecord[]> {
  let all: GameRecord[];
  try {
    all = await tx<GameRecord[]>("readonly", (s) => s.getAll());
    for (const r of memory.values()) {
      if (!all.some((a) => a.id === r.id)) all.push(r);
    }
  } catch {
    all = [...memory.values()];
  }
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
