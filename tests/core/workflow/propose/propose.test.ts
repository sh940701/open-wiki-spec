import { describe, it, expect, vi } from 'vitest';
import { propose } from '../../../../src/core/workflow/propose/propose.js';
import type { ProposeDeps, ProposeOptions } from '../../../../src/core/workflow/propose/types.js';
import type { VaultIndex, IndexRecord } from '../../../../src/types/index-record.js';
import type { RetrievalResult, RetrievalQuery } from '../../../../src/types/retrieval.js';
import type { SequencingResult } from '../../../../src/types/sequencing.js';
import type { ParseResult } from '../../../../src/core/parser/types.js';

function makeIndex(records: IndexRecord[] = []): VaultIndex {
  const map = new Map<string, IndexRecord>();
  for (const r of records) map.set(r.id, r);
  return {
    schema_version: '1',
    scanned_at: new Date().toISOString(),
    vaultRoot: '/tmp/test-vault',
    records: map,
    warnings: [],
  };
}

function makeRecord(overrides: Partial<IndexRecord> = {}): IndexRecord {
  return {
    schema_version: '1',
    id: 'test-id',
    type: 'feature',
    title: 'Test Feature',
    aliases: [],
    path: 'wiki/03-features/test-feature.md',
    status: 'active',
    tags: [],
    systems: [],
    sources: [],
    decisions: [],
    changes: [],
    depends_on: [],
    touches: [],
    links_out: [],
    links_in: [],
    headings: [],
    requirements: [],
    delta_summary: [],
    tasks: [],
    raw_text: '',
    content_hash: 'sha256:test',
    ...overrides,
  };
}

function makeSequencingResult(overrides: Partial<SequencingResult> = {}): SequencingResult {
  return {
    status: 'parallel_safe',
    pairwise_severities: [],
    requirement_conflicts: [],
    ordering: [],
    cycles: [],
    stale_bases: [],
    out_of_order_errors: [],
    reasons: [],
    related_changes: [],
    ...overrides,
  };
}

function makeRetrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    query: 'test query',
    classification: 'new_feature',
    confidence: 'high',
    sequencing: {
      status: 'parallel_safe',
      related_changes: [],
      reasons: [],
    },
    candidates: [],
    warnings: [],
    ...overrides,
  };
}

function makeParseResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    frontmatter: null,
    rawFrontmatter: null,
    sections: [],
    headings: [],
    wikilinks: [],
    requirements: [],
    deltaSummary: [],
    tasks: [],
    body: '',
    contentHash: 'sha256:test',
    errors: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ProposeDeps> = {}): ProposeDeps {
  return {
    buildIndex: vi.fn().mockReturnValue(makeIndex()),
    retrieve: vi.fn().mockReturnValue(makeRetrievalResult()),
    analyzeSequencing: vi.fn().mockReturnValue(makeSequencingResult()),
    parseNote: vi.fn().mockReturnValue(makeParseResult()),
    writeFile: vi.fn(),
    readFile: vi.fn().mockReturnValue(''),
    ...overrides,
  };
}

describe('propose', () => {
  const defaultOptions: ProposeOptions = {
    vaultRoot: '/test/vault',
  };

  it('normalizes query and runs preflight', async () => {
    const deps = makeDeps();
    await propose('add passkey login', defaultOptions, deps);
    expect(deps.buildIndex).toHaveBeenCalledWith('/test/vault');
    expect(deps.analyzeSequencing).toHaveBeenCalled();
    expect(deps.retrieve).toHaveBeenCalled();
  });

  it('returns asked_user for needs_confirmation classification', async () => {
    const deps = makeDeps({
      retrieve: vi.fn().mockReturnValue(makeRetrievalResult({
        classification: 'needs_confirmation',
        candidates: [
          { id: 'f1', type: 'feature', title: 'Auth Login', score: 62, reasons: ['match'] },
          { id: 'f2', type: 'feature', title: 'Auth SSO', score: 60, reasons: ['match'] },
        ],
      })),
    });
    const result = await propose('add passkey login', defaultOptions, deps);
    expect(result.action).toBe('asked_user');
    expect(result.target_change).toBeNull();
    expect(result.target_feature).toBeNull();
  });

  it('returns continued_change for existing_change classification', async () => {
    const existingChange = makeRecord({
      id: 'change-add-passkey',
      type: 'change',
      title: 'Add Passkey',
      status: 'in_progress',
      feature: 'feature-auth',
    });
    const featureRecord = makeRecord({
      id: 'feature-auth',
      type: 'feature',
      title: 'Auth Login',
    });
    const index = makeIndex([existingChange, featureRecord]);
    const deps = makeDeps({
      buildIndex: vi.fn().mockReturnValue(index),
      retrieve: vi.fn().mockReturnValue(makeRetrievalResult({
        classification: 'existing_change',
        candidates: [
          { id: 'change-add-passkey', type: 'change', title: 'Add Passkey', score: 85, reasons: ['match'] },
        ],
      })),
    });
    const result = await propose('add passkey login', defaultOptions, deps);
    expect(result.action).toBe('continued_change');
    expect(result.target_change?.id).toBe('change-add-passkey');
    expect(result.target_feature?.id).toBe('feature-auth');
  });

  it('creates new change for existing_feature classification', async () => {
    const featureRecord = makeRecord({
      id: 'feature-auth',
      type: 'feature',
      title: 'Auth Login',
    });
    const index = makeIndex([featureRecord]);
    const deps = makeDeps({
      buildIndex: vi.fn().mockReturnValue(index),
      retrieve: vi.fn().mockReturnValue(makeRetrievalResult({
        classification: 'existing_feature',
        candidates: [
          { id: 'feature-auth', type: 'feature', title: 'Auth Login', score: 80, reasons: ['match'] },
        ],
      })),
    });
    const result = await propose('add passkey login', defaultOptions, deps);
    expect(result.action).toBe('created_change');
    expect(result.target_feature?.id).toBe('feature-auth');
    expect(result.target_change).not.toBeNull();
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it('creates feature + change for new_feature classification', async () => {
    const deps = makeDeps();
    const result = await propose('add passkey login', defaultOptions, deps);
    expect(result.action).toBe('created_feature_and_change');
    expect(result.target_feature).not.toBeNull();
    expect(result.target_change).not.toBeNull();
    // Should write both feature and change files
    expect(deps.writeFile).toHaveBeenCalledTimes(2);
  });

  it('respects dryRun option -- no files written', async () => {
    const deps = makeDeps();
    const result = await propose('add passkey login', { ...defaultOptions, dryRun: true }, deps);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(result.target_change).toBeNull();
  });

  it('respects forceClassification override', async () => {
    const deps = makeDeps({
      retrieve: vi.fn().mockReturnValue(makeRetrievalResult({
        classification: 'new_feature', // would normally create new feature
      })),
    });
    const result = await propose('add passkey login', {
      ...defaultOptions,
      forceClassification: 'needs_confirmation',
    }, deps);
    expect(result.action).toBe('asked_user');
  });

  it('populates sequencing_warnings from sequencing reasons', async () => {
    const deps = makeDeps({
      analyzeSequencing: vi.fn().mockReturnValue(makeSequencingResult({
        reasons: ['needs_review: overlapping touches', 'info: ordering ok'],
      })),
    });
    const result = await propose('add passkey login', defaultOptions, deps);
    expect(result.sequencing_warnings).toContain('needs_review: overlapping touches');
    expect(result.sequencing_warnings).not.toContain('info: ordering ok');
  });
});
