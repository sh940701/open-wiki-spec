import { describe, it, expect } from 'vitest';
import { detectOutOfOrderErrors } from '../../../src/core/sequencing/out-of-order-detector.js';
import { createChange, createIndex } from '../../helpers/mock-index.js';

describe('detectOutOfOrderErrors', () => {
  it('detects in_progress change depending on proposed change', () => {
    const x = createChange('x', { status: 'in_progress', depends_on: ['y'] });
    const y = createChange('y', { status: 'proposed' });
    const idx = createIndex([x, y]);

    const errors = detectOutOfOrderErrors([x, y], idx.records);
    expect(errors).toHaveLength(1);
    expect(errors[0].change_id).toBe('x');
    expect(errors[0].dependency_id).toBe('y');
  });

  it('detects applied change depending on planned change', () => {
    const x = createChange('x', { status: 'applied', depends_on: ['y'] });
    const y = createChange('y', { status: 'planned' });
    const idx = createIndex([x, y]);

    const errors = detectOutOfOrderErrors([x, y], idx.records);
    expect(errors).toHaveLength(1);
  });

  it('no error when in_progress depends on applied', () => {
    const x = createChange('x', { status: 'in_progress', depends_on: ['y'] });
    const y = createChange('y', { status: 'applied' });
    const idx = createIndex([x, y]);

    const errors = detectOutOfOrderErrors([x, y], idx.records);
    expect(errors).toHaveLength(0);
  });

  it('no error when proposed depends on proposed (neither has jumped ahead)', () => {
    const x = createChange('x', { status: 'proposed', depends_on: ['y'] });
    const y = createChange('y', { status: 'proposed' });
    const idx = createIndex([x, y]);

    const errors = detectOutOfOrderErrors([x, y], idx.records);
    expect(errors).toHaveLength(0);
  });

  it('no error when in_progress depends on in_progress (same rank)', () => {
    const x = createChange('x', { status: 'in_progress', depends_on: ['y'] });
    const y = createChange('y', { status: 'in_progress' });
    const idx = createIndex([x, y]);

    const errors = detectOutOfOrderErrors([x, y], idx.records);
    expect(errors).toHaveLength(0);
  });

  it('skips non-change records', () => {
    const x = createChange('x', { status: 'in_progress', depends_on: ['y'], type: 'feature' as any });
    const y = createChange('y', { status: 'proposed' });
    const idx = createIndex([x, y]);

    // x has type overridden to 'feature' so should be skipped
    const errors = detectOutOfOrderErrors([x, y], idx.records);
    expect(errors).toHaveLength(0);
  });

  it('skips missing dependencies (reported by ordering)', () => {
    const x = createChange('x', { status: 'in_progress', depends_on: ['nonexistent'] });
    const idx = createIndex([x]);

    const errors = detectOutOfOrderErrors([x], idx.records);
    expect(errors).toHaveLength(0);
  });

  it('reports multiple errors for multiple behind dependencies', () => {
    const x = createChange('x', { status: 'in_progress', depends_on: ['y', 'z'] });
    const y = createChange('y', { status: 'in_progress' });
    const z = createChange('z', { status: 'proposed' });
    const idx = createIndex([x, y, z]);

    const errors = detectOutOfOrderErrors([x, y, z], idx.records);
    // Only z is behind (proposed while x is in_progress)
    expect(errors).toHaveLength(1);
    expect(errors[0].dependency_id).toBe('z');
  });
});
