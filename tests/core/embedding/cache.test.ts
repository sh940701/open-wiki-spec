import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadEmbeddingCache,
  saveEmbeddingCache,
  getCachedVector,
  setCachedVector,
  createEmptyCache,
  type EmbeddingCache,
} from '../../../src/core/embedding/cache.js';

describe('EmbeddingCache', () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-cache-test-'));
    cachePath = path.join(tmpDir, '.ows-cache', 'embeddings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates an empty cache with model info', () => {
    const cache = createEmptyCache('test-model');
    expect(cache.model).toBe('test-model');
    expect(cache.entries).toEqual({});
  });

  it('saves and loads cache from disk', () => {
    const cache = createEmptyCache('test-model');
    cache.entries['note-1'] = { vector: [0.1, 0.2], content_hash: 'sha256:abc' };

    saveEmbeddingCache(cachePath, cache);
    const loaded = loadEmbeddingCache(cachePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.model).toBe('test-model');
    expect(loaded!.entries['note-1'].vector).toEqual([0.1, 0.2]);
    expect(loaded!.entries['note-1'].content_hash).toBe('sha256:abc');
  });

  it('returns null when cache file does not exist', () => {
    const result = loadEmbeddingCache(path.join(tmpDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('returns null for corrupted cache file', () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'not-json', 'utf-8');
    const result = loadEmbeddingCache(cachePath);
    expect(result).toBeNull();
  });

  it('getCachedVector returns vector when hash matches', () => {
    const cache = createEmptyCache('m');
    cache.entries['id-1'] = { vector: [1, 2, 3], content_hash: 'h1' };
    expect(getCachedVector(cache, 'id-1', 'h1')).toEqual([1, 2, 3]);
  });

  it('getCachedVector returns null when hash differs', () => {
    const cache = createEmptyCache('m');
    cache.entries['id-1'] = { vector: [1, 2, 3], content_hash: 'h1' };
    expect(getCachedVector(cache, 'id-1', 'h2')).toBeNull();
  });

  it('getCachedVector returns null for missing entry', () => {
    const cache = createEmptyCache('m');
    expect(getCachedVector(cache, 'missing', 'h1')).toBeNull();
  });

  it('setCachedVector stores vector and hash', () => {
    const cache = createEmptyCache('m');
    setCachedVector(cache, 'id-1', [4, 5, 6], 'h2');
    expect(cache.entries['id-1']).toEqual({ vector: [4, 5, 6], content_hash: 'h2' });
  });

  it('invalidates model mismatch on load', () => {
    const cache = createEmptyCache('model-A');
    cache.entries['id-1'] = { vector: [1], content_hash: 'h1' };
    saveEmbeddingCache(cachePath, cache);

    // Load expects a different model
    const loaded = loadEmbeddingCache(cachePath, 'model-B');
    expect(loaded).toBeNull();
  });

  it('loads normally when model matches', () => {
    const cache = createEmptyCache('model-A');
    cache.entries['id-1'] = { vector: [1], content_hash: 'h1' };
    saveEmbeddingCache(cachePath, cache);

    const loaded = loadEmbeddingCache(cachePath, 'model-A');
    expect(loaded).not.toBeNull();
    expect(loaded!.entries['id-1'].vector).toEqual([1]);
  });
});
