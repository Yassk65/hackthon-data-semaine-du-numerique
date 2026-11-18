/** Petit magasin clé-valeur : Netlify Blobs en production, mémoire dans les tests. */
import { getStore } from "@netlify/blobs";

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    async get<T>(key: string) { const v = m.get(key); return v === undefined ? null : (JSON.parse(v) as T); },
    async set(key, value) { m.set(key, JSON.stringify(value)); },
    async delete(key) { m.delete(key); },
    async list(prefix = "") { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

/** Lecture « strong » : le navigateur interroge l'état d'un job juste après son écriture. */
export function blobKV(name: string): KV {
  const store = getStore({ name, consistency: "strong" });
  return {
    async get<T>(key: string) { return (await store.get(key, { type: "json" })) as T | null; },
    async set(key, value) { await store.setJSON(key, value); },
    async delete(key) { await store.delete(key); },
    async list(prefix) { return (await store.list(prefix ? { prefix } : undefined)).blobs.map((b) => b.key); },
  };
}
