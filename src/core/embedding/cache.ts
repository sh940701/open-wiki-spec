import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { assertInsideVault } from '../../utils/path-safety.js';

export interface EmbeddingCacheEntry {
  vector: number[];
  content_hash: string;
}

export interface EmbeddingCache {
  model: string;
  entries: Record<string, EmbeddingCacheEntry>;
}

export function createEmptyCache(model: string): EmbeddingCache {
  return { model, entries: {} };
}

/**
 * Load embedding cache from disk.
 * Returns null if file doesn't exist, is corrupted, or model mismatches.
 */
export function loadEmbeddingCache(
  filePath: string,
  expectedModel?: string,
): EmbeddingCache | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as EmbeddingCache;
    if (!data.model || !data.entries || typeof data.entries !== 'object') return null;
    if (expectedModel && data.model !== expectedModel) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save embedding cache to disk atomically (write-to-temp-then-rename).
 * Prevents corruption from interrupted or concurrent writes.
 */
export function saveEmbeddingCache(filePath: string, cache: EmbeddingCache): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.embeddings-${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(cache), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Get cached vector if content_hash matches.
 */
export function getCachedVector(
  cache: EmbeddingCache,
  id: string,
  currentHash: string,
): number[] | null {
  const entry = cache.entries[id];
  if (!entry || entry.content_hash !== currentHash) return null;
  return entry.vector;
}

/**
 * Store a vector in the cache.
 */
export function setCachedVector(
  cache: EmbeddingCache,
  id: string,
  vector: number[],
  contentHash: string,
): void {
  cache.entries[id] = { vector, content_hash: contentHash };
}
