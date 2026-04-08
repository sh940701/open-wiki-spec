import { describe, it, expect } from 'vitest';
import { computeTouchesSeverity } from '../../../src/core/sequencing/touches-analyzer.js';
import { createChange, createFeature, createSystem, createIndex } from '../../helpers/mock-index.js';

describe('computeTouchesSeverity', () => {
  it('returns parallel_safe when no touch overlap', () => {
    const featureA = createFeature('feat-a');
    const featureB = createFeature('feat-b');
    const changeA = createChange('chg-a', { touches: ['feat-a'] });
    const changeB = createChange('chg-b', { touches: ['feat-b'] });
    const idx = createIndex([featureA, featureB, changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('parallel_safe');
    expect(result.overlapping_features).toEqual([]);
    expect(result.overlapping_systems).toEqual([]);
  });

  it('returns needs_review when same System but different Features', () => {
    const sys = createSystem('sys-auth');
    const featureA = createFeature('feat-a');
    const featureB = createFeature('feat-b');
    const changeA = createChange('chg-a', { touches: ['sys-auth'] });
    const changeB = createChange('chg-b', { touches: ['sys-auth'] });
    const idx = createIndex([sys, featureA, featureB, changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('needs_review');
    expect(result.overlapping_systems).toEqual(['sys-auth']);
    expect(result.overlapping_features).toEqual([]);
  });

  it('returns conflict_candidate when same Feature touched', () => {
    const feature = createFeature('feat-auth');
    const changeA = createChange('chg-a', { touches: ['feat-auth'] });
    const changeB = createChange('chg-b', { touches: ['feat-auth'] });
    const idx = createIndex([feature, changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('conflict_candidate');
    expect(result.overlapping_features).toEqual(['feat-auth']);
  });

  it('returns blocked when A depends_on B and B is not applied', () => {
    const changeA = createChange('chg-a', { depends_on: ['chg-b'], status: 'proposed' });
    const changeB = createChange('chg-b', { status: 'proposed' });
    const idx = createIndex([changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('blocked');
  });

  it('does not return blocked when A depends_on B and B is applied', () => {
    const feature = createFeature('feat-a');
    const changeA = createChange('chg-a', { depends_on: ['chg-b'], touches: ['feat-a'] });
    const changeB = createChange('chg-b', { status: 'applied', touches: ['feat-a'] });
    const idx = createIndex([feature, changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    // Not blocked, but conflict_candidate due to shared feature touch
    expect(result.severity).not.toBe('blocked');
  });

  it('returns blocked when B depends_on A and A is not applied', () => {
    const changeA = createChange('chg-a', { status: 'in_progress' });
    const changeB = createChange('chg-b', { depends_on: ['chg-a'], status: 'proposed' });
    const idx = createIndex([changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('blocked');
  });

  it('returns parallel_safe when one change has no touches', () => {
    const changeA = createChange('chg-a', { touches: [] });
    const changeB = createChange('chg-b', { touches: ['feat-x'] });
    const idx = createIndex([changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('parallel_safe');
  });

  it('handles touch target ID that does not exist in index gracefully', () => {
    const changeA = createChange('chg-a', { touches: ['nonexistent'] });
    const changeB = createChange('chg-b', { touches: ['nonexistent'] });
    const idx = createIndex([changeA, changeB]);

    // overlap exists but target not found -> parallel_safe fallback
    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('parallel_safe');
  });

  it('prefers conflict_candidate when both Feature and System overlap', () => {
    const feature = createFeature('feat-auth');
    const sys = createSystem('sys-auth');
    const changeA = createChange('chg-a', { touches: ['feat-auth', 'sys-auth'] });
    const changeB = createChange('chg-b', { touches: ['feat-auth', 'sys-auth'] });
    const idx = createIndex([feature, sys, changeA, changeB]);

    const result = computeTouchesSeverity(changeA, changeB, idx.records);
    expect(result.severity).toBe('conflict_candidate');
    expect(result.overlapping_features).toContain('feat-auth');
    expect(result.overlapping_systems).toContain('sys-auth');
  });
});
