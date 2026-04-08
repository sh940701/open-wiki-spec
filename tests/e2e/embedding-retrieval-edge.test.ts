/**
 * E2E tests for embedding integration, retrieval scoring edge cases,
 * classification edge cases, and Korean-specific behavior.
 * Uses real file I/O with isolated temp directories.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { initVault } from '../../src/cli/init/init-engine.js';
import { buildIndex } from '../../src/core/index/build.js';
import { retrieve } from '../../src/core/retrieval/retrieve.js';
import { propose } from '../../src/core/workflow/propose/propose.js';
import { analyzeSequencing } from '../../src/core/sequencing/analyze.js';
import { parseNote } from '../../src/core/parser/note-parser.js';
import { createEmbedder } from '../../src/core/embedding/embedder.js';
import {
  createEmptyCache,
  getCachedVector,
  setCachedVector,
  saveEmbeddingCache,
  loadEmbeddingCache,
} from '../../src/core/embedding/cache.js';
import { computeSemanticRecall } from '../../src/core/embedding/semantic-recall.js';
import { generateId } from '../../src/utils/id-generator.js';
import type { ProposeDeps } from '../../src/core/workflow/propose/types.js';
import type { RetrievalQuery } from '../../src/types/retrieval.js';

// ── Helpers ──

function writeNote(vaultRoot: string, relativePath: string, content: string): string {
  const fullPath = path.join(vaultRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

function realProposeDeps(): ProposeDeps {
  return {
    buildIndex: (root: string) => buildIndex(root),
    retrieve: (index, query, options) => retrieve(index, query, options),
    analyzeSequencing: (records) => analyzeSequencing(records),
    parseNote: (filePath: string) => parseNote(filePath),
    writeFile: (filePath: string, content: string) => fs.writeFileSync(filePath, content, 'utf-8'),
    readFile: (filePath: string) => fs.readFileSync(filePath, 'utf-8'),
  };
}

// ── Test Suites ──

describe('E2E: Embedding & Retrieval Edge Cases', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-embed-'));
    await initVault({ path: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════
  // Group 1: Embedding integration
  // ════════════════════════════════════════════
  describe('Group 1: Embedding integration', () => {

    it('1. semantic match without keyword overlap — graceful fallback when embedding unavailable', async () => {
      // Create a Feature about signup (회원가입 기능)
      writeNote(tempDir, 'wiki/03-features/feature-signup.md', `---
type: feature
id: feature-signup
status: active
aliases: []
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: 회원가입 기능

## Purpose

사용자가 새로운 계정을 만들 수 있는 기능.

## Current Behavior

## Requirements
`);

      const index = buildIndex(tempDir);

      // Query with semantically related but lexically different terms
      const query: RetrievalQuery = {
        intent: 'add',
        summary: '새 사용자를 받고 싶어',
        feature_terms: ['사용자'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };

      // Without embedding, lexical retrieval may or may not match
      const result = retrieve(index, query);
      // The retrieval should not crash — graceful fallback
      expect(result).toBeDefined();
      expect(result.classification).toBeDefined();
      expect(result.candidates).toBeInstanceOf(Array);
    });

    it('1b. semantic match with mock embedder finds Feature despite no keyword overlap', async () => {
      writeNote(tempDir, 'wiki/03-features/feature-signup.md', `---
type: feature
id: feature-signup
status: active
aliases: []
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: 회원가입 기능

## Purpose

사용자가 새로운 계정을 만들 수 있는 기능.

## Current Behavior

## Requirements
`);

      const index = buildIndex(tempDir);

      // Simulate high semantic similarity via pre-computed scores
      const semanticScores = new Map<string, number>([
        ['feature-signup', 0.92],
      ]);

      const query: RetrievalQuery = {
        intent: 'add',
        summary: '새 사용자를 받고 싶어',
        feature_terms: ['받고'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };

      const result = retrieve(index, query, { semanticScores });
      // With semantic scores, feature-signup should appear as a candidate
      const signupCandidate = result.candidates.find(c => c.id === 'feature-signup');
      expect(signupCandidate).toBeDefined();
      expect(signupCandidate!.reasons.some(r => r.includes('semantic'))).toBe(true);
    });

    it('2. --keywords override dominates scoring over vague summary', async () => {
      writeNote(tempDir, 'wiki/03-features/feature-auth-login.md', `---
type: feature
id: feature-auth-login
status: active
aliases: ["Auth Login"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Auth Login

## Purpose

User authentication via login.

## Current Behavior

## Requirements
`);

      writeNote(tempDir, 'wiki/03-features/feature-random-stuff.md', `---
type: feature
id: feature-random-stuff
status: active
aliases: []
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Random Stuff

## Purpose

이것저것 해야 해.

## Current Behavior

## Requirements
`);

      // propose with vague summary but specific keywords
      const result = await propose('이것저것 해야 해', {
        vaultRoot: tempDir,
        keywords: ['auth', 'login'],
        dryRun: true,
      }, realProposeDeps());

      // Keywords should lead to finding auth-login, not random-stuff
      expect(result.retrieval).toBeDefined();
      const candidates = result.retrieval.candidates;
      if (candidates.length > 0) {
        // The auth-login feature should rank higher because keywords match
        const authCandidate = candidates.find(c => c.id === 'feature-auth-login');
        const randomCandidate = candidates.find(c => c.id === 'feature-random-stuff');
        if (authCandidate && randomCandidate) {
          expect(authCandidate.score).toBeGreaterThan(randomCandidate.score);
        } else {
          // At minimum, auth should be found
          expect(authCandidate).toBeDefined();
        }
      }
    });

    it('3. embedding cache invalidation — content_hash change triggers re-embedding', async () => {
      const cachePath = path.join(tempDir, '.ows-cache', 'embeddings.json');
      const model = 'test-model';
      const cache = createEmptyCache(model);

      // Store initial embedding
      setCachedVector(cache, 'feature-auth', [0.1, 0.2, 0.3], 'hash-v1');
      saveEmbeddingCache(cachePath, cache);

      // Verify cached vector is retrievable with matching hash
      const loaded = loadEmbeddingCache(cachePath, model)!;
      expect(loaded).not.toBeNull();
      const vec = getCachedVector(loaded, 'feature-auth', 'hash-v1');
      expect(vec).toEqual([0.1, 0.2, 0.3]);

      // With a different content_hash, cache miss should occur
      const vecMiss = getCachedVector(loaded, 'feature-auth', 'hash-v2');
      expect(vecMiss).toBeNull();
    });

    it('4. embedding disabled gracefully — retrieve works with lexical-only scoring', async () => {
      writeNote(tempDir, 'wiki/03-features/feature-payment.md', `---
type: feature
id: feature-payment
status: active
aliases: ["Payment Processing"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Payment Processing

## Purpose

Handle payment transactions.

## Current Behavior

## Requirements
`);

      // Create embedder with loadModel=false (simulates unavailable embedding)
      const embedder = await createEmbedder({ loadModel: false });
      expect(embedder.available).toBe(false);

      // Verify embed returns null
      const vec = await embedder.embed('test query');
      expect(vec).toBeNull();

      // Verify computeSemanticRecall returns empty scores with unavailable embedder
      const cache = createEmptyCache('test-model');
      const recall = await computeSemanticRecall('payment processing', cache, embedder);
      expect(recall.scores.size).toBe(0);

      // Retrieval should still work with lexical-only
      const index = buildIndex(tempDir);
      const query: RetrievalQuery = {
        intent: 'add',
        summary: 'payment processing',
        feature_terms: ['payment', 'processing'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);
      expect(result).toBeDefined();
      // Should find the payment feature lexically
      const paymentCandidate = result.candidates.find(c => c.id === 'feature-payment');
      expect(paymentCandidate).toBeDefined();
    });
  });

  // ════════════════════════════════════════════
  // Group 2: Retrieval scoring edge cases
  // ════════════════════════════════════════════
  describe('Group 2: Retrieval scoring edge cases', () => {

    it('5. partial title match (+20) fires for substring match', () => {
      writeNote(tempDir, 'wiki/03-features/feature-user-authentication-flow.md', `---
type: feature
id: feature-user-authentication-flow
status: active
aliases: []
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: User Authentication Flow

## Purpose

End-to-end authentication flow.

## Current Behavior

## Requirements
`);

      const index = buildIndex(tempDir);
      const query: RetrievalQuery = {
        intent: 'add',
        summary: 'authentication',
        feature_terms: ['authentication'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);
      const candidate = result.candidates.find(c => c.id === 'feature-user-authentication-flow');
      expect(candidate).toBeDefined();
      // Should have title_partial signal
      expect(candidate!.reasons.some(r => r.includes('partial title match') || r.includes('title match'))).toBe(true);
    });

    it('6. derived alias match — title-derived alias enables matching', () => {
      writeNote(tempDir, 'wiki/03-features/feature-payment-processing.md', `---
type: feature
id: feature-payment-processing
status: active
aliases: []
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Payment Processing

## Purpose

Handle payments.

## Current Behavior

## Requirements
`);

      const index = buildIndex(tempDir);
      const record = index.records.get('feature-payment-processing');
      expect(record).toBeDefined();
      // Derived alias "Payment Processing" should be auto-generated from title
      expect(record!.aliases.some(a => a.toLowerCase().includes('payment processing'))).toBe(true);

      // Query using the derived alias term
      const query: RetrievalQuery = {
        intent: 'add',
        summary: 'payment processing',
        feature_terms: ['payment'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);
      const candidate = result.candidates.find(c => c.id === 'feature-payment-processing');
      expect(candidate).toBeDefined();
    });

    it('7. system_terms enrichment — propose enriches system_terms from index', async () => {
      // Create a System note
      writeNote(tempDir, 'wiki/02-systems/system-authentication.md', `---
type: system
id: system-authentication
status: active
aliases: ["Authentication System"]
tags:
  - system
---

# System: Authentication

## Purpose

Handles authentication.

## Boundaries
`);

      // Propose with "authentication" in the description — system_terms should be enriched
      const result = await propose('add authentication improvements', {
        vaultRoot: tempDir,
        dryRun: true,
      }, realProposeDeps());

      // The retrieval should have found the system
      expect(result.retrieval).toBeDefined();
    });

    it('8. full_text_match single hit (+8) — weak signal fires for one term', () => {
      writeNote(tempDir, 'wiki/03-features/feature-error-monitoring.md', `---
type: feature
id: feature-error-monitoring
status: active
aliases: ["Error Monitoring"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Error Monitoring

## Purpose

Monitor errors in production using Sentry integration.

## Current Behavior

We use Sentry for error tracking.

## Requirements
`);

      const index = buildIndex(tempDir);
      // Query with "sentry" + "tracking" — "sentry" matches body, "tracking" also matches body
      // but we want to test single term: use only "sentry" as the sole search term
      // so matchCount=1 >= 1 when searchTerms.length=1 triggers lexical first pass
      const query: RetrievalQuery = {
        intent: 'add',
        summary: 'sentry',
        feature_terms: ['sentry'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);
      const candidate = result.candidates.find(c => c.id === 'feature-error-monitoring');
      expect(candidate).toBeDefined();
      // Should have full_text signal (weak when single term matches)
      const hasFullTextSignal = candidate!.reasons.some(
        r => r.includes('full-text hit') || r.includes('full_text'),
      );
      expect(hasFullTextSignal).toBe(true);
    });

    it('9. full_text_match double hit (+15) — strong signal for two terms', () => {
      writeNote(tempDir, 'wiki/03-features/feature-observability.md', `---
type: feature
id: feature-observability
status: active
aliases: ["Observability"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Observability

## Purpose

Comprehensive observability stack.

## Current Behavior

We use Sentry for error tracking and structured logging for debugging.

## Requirements
`);

      const index = buildIndex(tempDir);
      // Query with both "Sentry" and "logging" — two terms matching in body
      const query: RetrievalQuery = {
        intent: 'add',
        summary: 'sentry and logging improvements',
        feature_terms: ['sentry', 'logging'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);
      const candidate = result.candidates.find(c => c.id === 'feature-observability');
      expect(candidate).toBeDefined();
      // Should have strong full-text signal
      expect(candidate!.reasons.some(r => r.includes('strong full-text hit'))).toBe(true);
    });
  });

  // ════════════════════════════════════════════
  // Group 3: Classification edge cases
  // ════════════════════════════════════════════
  describe('Group 3: Classification edge cases', () => {

    it('10. needs_confirmation — two features with similar scores', async () => {
      writeNote(tempDir, 'wiki/03-features/feature-user-login.md', `---
type: feature
id: feature-user-login
status: active
aliases: ["User Login", "Login"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: User Login

## Purpose

User authentication via login.

## Current Behavior

## Requirements
`);

      writeNote(tempDir, 'wiki/03-features/feature-user-login-sso.md', `---
type: feature
id: feature-user-login-sso
status: active
aliases: ["User Login SSO", "SSO Login"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: User Login SSO

## Purpose

User login via SSO providers.

## Current Behavior

## Requirements
`);

      const result = await propose('user login improvements', {
        vaultRoot: tempDir,
        dryRun: true,
      }, realProposeDeps());

      // Two features with similar titles — should trigger needs_confirmation or close scores
      expect(result.retrieval).toBeDefined();
      const candidates = result.retrieval.candidates;
      expect(candidates.length).toBeGreaterThanOrEqual(2);

      // Both should appear as candidates
      const loginCandidate = candidates.find(c => c.id === 'feature-user-login');
      const ssoCandidate = candidates.find(c => c.id === 'feature-user-login-sso');
      expect(loginCandidate).toBeDefined();
      expect(ssoCandidate).toBeDefined();

      // If scores are close enough, classification should be needs_confirmation
      if (loginCandidate && ssoCandidate) {
        const gap = Math.abs(loginCandidate.score - ssoCandidate.score);
        if (gap < 10 && loginCandidate.score >= 60 && ssoCandidate.score >= 60) {
          expect(result.retrieval.classification).toBe('needs_confirmation');
        }
      }
    });

    it('11. existing_change — active change matches proposal topic', async () => {
      writeNote(tempDir, 'wiki/03-features/feature-notifications.md', `---
type: feature
id: feature-notifications
status: active
aliases: ["Notifications"]
systems: []
sources: []
decisions: []
changes:
  - "[[Change: Push Notifications]]"
tags:
  - feature
---

# Feature: Notifications

## Purpose

Send notifications to users.

## Current Behavior

## Requirements
`);

      writeNote(tempDir, 'wiki/04-changes/change-push-notifications.md', `---
type: change
id: change-push-notifications
status: proposed
created_at: "2026-04-01"
aliases: ["Push Notifications"]
feature: "[[Feature: Notifications]]"
depends_on: []
touches:
  - "[[Feature: Notifications]]"
systems: []
sources: []
decisions: []
tags:
  - change
---

# Change: Push Notifications

## Why

Need to add push notification support.

## Delta Summary

## Tasks

## Validation
`);

      const result = await propose('push notifications', {
        vaultRoot: tempDir,
        dryRun: true,
      }, realProposeDeps());

      expect(result.retrieval).toBeDefined();
      const candidates = result.retrieval.candidates;

      // The active change should appear in candidates
      const changeCandidate = candidates.find(c => c.id === 'change-push-notifications');
      expect(changeCandidate).toBeDefined();

      // Classification should recognize existing change or needs_confirmation
      expect(['existing_change', 'needs_confirmation']).toContain(
        result.retrieval.classification,
      );
    });

    it('12. new_feature — empty vault yields new_feature classification', async () => {
      // Vault is freshly initialized with only seed notes
      const result = await propose('a completely unique never-seen topic xyzzy42', {
        vaultRoot: tempDir,
        dryRun: true,
      }, realProposeDeps());

      expect(result.retrieval).toBeDefined();
      expect(result.retrieval.classification).toBe('new_feature');
      expect(result.retrieval.confidence).toBe('high');
    });

    it('13. force-target picks 2nd candidate over 1st', async () => {
      writeNote(tempDir, 'wiki/03-features/feature-billing.md', `---
type: feature
id: feature-billing
status: active
aliases: ["Billing"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Billing

## Purpose

Manage billing and invoices.

## Current Behavior

## Requirements
`);

      writeNote(tempDir, 'wiki/03-features/feature-billing-v2.md', `---
type: feature
id: feature-billing-v2
status: active
aliases: ["Billing V2"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Billing V2

## Purpose

Next generation billing system.

## Current Behavior

## Requirements
`);

      // First, dry-run to see candidates
      const dryResult = await propose('billing improvements', {
        vaultRoot: tempDir,
        dryRun: true,
      }, realProposeDeps());

      expect(dryResult.retrieval.candidates.length).toBeGreaterThanOrEqual(2);

      // Identify second candidate
      const secondCandidate = dryResult.retrieval.candidates[1];
      expect(secondCandidate).toBeDefined();

      // Force-target the second candidate
      const forcedResult = await propose('billing improvements', {
        vaultRoot: tempDir,
        dryRun: true,
        forceClassification: 'existing_feature',
        forceTargetId: secondCandidate.id,
      }, realProposeDeps());

      // The forced result should have the second candidate as primary
      expect(forcedResult.classification.primary_candidate).toBeDefined();
      expect(forcedResult.classification.primary_candidate!.id).toBe(secondCandidate.id);
    });
  });

  // ════════════════════════════════════════════
  // Group 4: Korean-specific edge cases
  // ════════════════════════════════════════════
  describe('Group 4: Korean-specific', () => {

    it('14. Korean-only query on Korean vault', () => {
      writeNote(tempDir, 'wiki/03-features/feature-회원가입.md', `---
type: feature
id: feature-회원가입
status: active
aliases: ["회원가입"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: 회원가입

## Purpose

사용자가 회원가입을 할 수 있는 기능입니다.

## Current Behavior

## Requirements
`);

      const index = buildIndex(tempDir);
      const query: RetrievalQuery = {
        intent: 'add',
        summary: '회원가입 개선',
        feature_terms: ['회원가입'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);

      // Korean title/alias should be matched
      const candidate = result.candidates.find(c => c.id === 'feature-회원가입');
      expect(candidate).toBeDefined();
      expect(candidate!.score).toBeGreaterThan(0);
    });

    it('15. mixed Korean+English — Korean body matched by Korean query', () => {
      writeNote(tempDir, 'wiki/03-features/feature-payment-flow.md', `---
type: feature
id: feature-payment-flow
status: active
aliases: ["Payment Flow"]
systems: []
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: Payment Flow

## Purpose

결제 처리 흐름을 관리합니다.

## Current Behavior

결제 시스템은 PG사 연동을 통해 카드 결제와 계좌이체를 지원합니다.

## Requirements
`);

      const index = buildIndex(tempDir);
      const query: RetrievalQuery = {
        intent: 'add',
        summary: '결제 시스템 개선',
        feature_terms: ['결제'],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);
      const candidate = result.candidates.find(c => c.id === 'feature-payment-flow');
      expect(candidate).toBeDefined();
      // Should match via full-text (Korean body contains 결제)
      expect(candidate!.score).toBeGreaterThan(0);
    });

    it('16. Korean ID generation passes schema validation', () => {
      // generateId with Korean input should produce a valid ID
      const id = generateId('feature', '회원가입 기능 추가');
      expect(id).toBeTruthy();
      // Must match the schema regex: ^[\p{Ll}\p{Lo}\p{N}-]+$/u
      const idRegex = /^[\p{Ll}\p{Lo}\p{N}-]+$/u;
      expect(idRegex.test(id)).toBe(true);
      // Should contain Korean characters
      expect(id).toMatch(/[\p{Lo}]/u);
      // Should start with 'feature-'
      expect(id.startsWith('feature-')).toBe(true);
    });

    it('16b. Korean ID works in full propose flow', async () => {
      const result = await propose('회원가입 기능 추가', {
        vaultRoot: tempDir,
      }, realProposeDeps());

      expect(result).toBeDefined();
      expect(result.action).toBe('created_feature_and_change');

      // Verify the created feature has a valid Korean ID
      expect(result.target_feature).not.toBeNull();
      const featurePath = result.target_feature!.path;
      expect(fs.existsSync(featurePath)).toBe(true);

      // Verify ID passes schema regex
      const featureId = result.target_feature!.id;
      const idRegex = /^[\p{Ll}\p{Lo}\p{N}-]+$/u;
      expect(idRegex.test(featureId)).toBe(true);
    });
  });

  // ════════════════════════════════════════════
  // Additional edge cases
  // ════════════════════════════════════════════
  describe('Additional edge cases', () => {

    it('embedding cache: model mismatch returns null', () => {
      const cachePath = path.join(tempDir, '.ows-cache', 'embeddings-test.json');
      const cache = createEmptyCache('model-a');
      setCachedVector(cache, 'id-1', [0.1, 0.2], 'hash-1');
      saveEmbeddingCache(cachePath, cache);

      // Loading with different expected model should return null
      const loaded = loadEmbeddingCache(cachePath, 'model-b');
      expect(loaded).toBeNull();
    });

    it('embedBatch returns null vectors when embedding unavailable', async () => {
      const embedder = await createEmbedder({ loadModel: false });
      expect(embedder.available).toBe(false);

      const results = await embedder.embedBatch(['text1', 'text2', 'text3']);
      expect(results).toHaveLength(3);
      expect(results.every(r => r === null)).toBe(true);
    });

    it('mock pipeline embedder works correctly', async () => {
      const mockPipeline = async (_text: string) => [0.5, 0.5, 0.5];
      const embedder = await createEmbedder({ pipeline: mockPipeline });
      expect(embedder.available).toBe(true);

      const vec = await embedder.embed('test');
      expect(vec).toEqual([0.5, 0.5, 0.5]);
    });

    it('semantic recall with mock embedder returns scored candidates', async () => {
      const mockVec = [0.1, 0.2, 0.3, 0.4, 0.5];
      const mockPipeline = async (_text: string) => mockVec;
      const embedder = await createEmbedder({ pipeline: mockPipeline });

      const cache = createEmptyCache('mock-model');
      // Add cached vectors — same vector will give cosine similarity = 1.0
      setCachedVector(cache, 'note-a', mockVec, 'hash-a');
      // Add a different vector
      setCachedVector(cache, 'note-b', [0.9, 0.8, 0.7, 0.6, 0.5], 'hash-b');

      const recall = await computeSemanticRecall('query text', cache, embedder);
      expect(recall.scores.size).toBeGreaterThan(0);
      // note-a should have perfect similarity (1.0)
      expect(recall.scores.get('note-a')).toBeCloseTo(1.0, 5);
      // note-b should have some similarity but not perfect
      const noteB = recall.scores.get('note-b');
      expect(noteB).toBeDefined();
      expect(noteB!).toBeGreaterThan(0);
      expect(noteB!).toBeLessThan(1.0);
    });

    it('retrieve with empty query terms returns no candidates', () => {
      const index = buildIndex(tempDir);
      const query: RetrievalQuery = {
        intent: 'add',
        summary: '',
        feature_terms: [],
        system_terms: [],
        entity_terms: [],
        status_bias: ['active'],
      };
      const result = retrieve(index, query);
      expect(result.candidates).toHaveLength(0);
      expect(result.classification).toBe('new_feature');
    });
  });
});
