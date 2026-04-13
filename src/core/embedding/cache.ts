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
  /** Model revision hash — cache is invalidated when revision changes. */
  revision?: string;
  entries: Record<string, EmbeddingCacheEntry>;
}

export function createEmptyCache(model: string, revision?: string): EmbeddingCache {
  return { model, revision, entries: {} };
}

/**
 * Load embedding cache from disk.
 * Returns null if file doesn't exist, is corrupted, or model mismatches.
 */
export function loadEmbeddingCache(
  filePath: string,
  expectedModel?: string,
  expectedRevision?: string,
): EmbeddingCache | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as EmbeddingCache;
    if (!data.model || !data.entries || typeof data.entries !== 'object') return null;
    if (expectedModel && data.model !== expectedModel) return null;
    // Invalidate cache when revision changes
    if (expectedRevision && data.revision && data.revision !== expectedRevision) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save embedding cache to disk atomically (write-to-temp-then-rename).
 *
 * Concurrent-write safety: two simultaneous `propose` processes each load
 * the file, add their own entries, and save. A naive last-write-wins would
 * drop the other process's new entries. Before the atomic rename, re-read
 * whatever is currently on disk and merge its entries with ours — favoring
 * in-memory entries on conflict (newest wins, which is safe because cache
 * entries are content-addressed by content_hash). Cache misses cost an
 * embed recompute but never data loss.
 */
export function saveEmbeddingCache(filePath: string, cache: EmbeddingCache): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Merge with any on-disk version that was written by a concurrent process
  // between our load and save. Only merge when model/revision match — mismatch
  // means the other process already invalidated our cache generation.
  let merged = cache;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const onDisk = JSON.parse(raw) as EmbeddingCache;
      if (
        onDisk &&
        onDisk.model === cache.model &&
        (onDisk.revision ?? undefined) === (cache.revision ?? undefined) &&
        onDisk.entries &&
        typeof onDisk.entries === 'object'
      ) {
        merged = {
          model: cache.model,
          revision: cache.revision,
          // Spread on-disk first so in-memory entries win on key collision.
          entries: { ...onDisk.entries, ...cache.entries },
        };
      }
    }
  } catch {
    // On-disk file corrupted or unreadable — fall through and overwrite
    // with our in-memory copy. We prefer losing the corrupted bytes over
    // failing the whole save.
  }

  const tmpPath = path.join(dir, `.embeddings-${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(merged), 'utf-8');
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
