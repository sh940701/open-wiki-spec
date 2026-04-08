import { describe, it, expect } from 'vitest';
import { computeReverseIndex } from '../../../src/core/index/reverse.js';
import type { IndexRecord } from '../../../src/types/index-record.js';

function makeRecord(id: string, linksOut: string[]): IndexRecord {
  return {
    schema_version: '1.0.0',
    id,
    type: 'feature',
    title: id,
    aliases: [],
    path: `wiki/${id}.md`,
    status: 'active',
    tags: [],
    systems: [],
    sources: [],
    decisions: [],
    changes: [],
    depends_on: [],
    touches: [],
    links_out: linksOut,
    links_in: [],
    headings: [],
    requirements: [],
    delta_summary: [],
    tasks: [],
    raw_text: '',
    content_hash: 'sha256:abc',
  };
}

describe('computeReverseIndex', () => {
  it('computes links_in from links_out', () => {
    const records = new Map<string, IndexRecord>();
    records.set('a', makeRecord('a', ['b']));
    records.set('b', makeRecord('b', ['c']));
    records.set('c', makeRecord('c', []));

    computeReverseIndex(records);

    expect(records.get('a')!.links_in).toEqual([]);
    expect(records.get('b')!.links_in).toEqual(['a']);
    expect(records.get('c')!.links_in).toEqual(['b']);
  });

  it('handles mutual links', () => {
    const records = new Map<string, IndexRecord>();
    records.set('a', makeRecord('a', ['b']));
    records.set('b', makeRecord('b', ['a']));

    computeReverseIndex(records);

    expect(records.get('a')!.links_in).toEqual(['b']);
    expect(records.get('b')!.links_in).toEqual(['a']);
  });

  it('avoids duplicate entries in links_in', () => {
    const records = new Map<string, IndexRecord>();
    const a = makeRecord('a', ['b', 'b']); // duplicate link
    records.set('a', a);
    records.set('b', makeRecord('b', []));

    computeReverseIndex(records);

    expect(records.get('b')!.links_in).toEqual(['a']);
  });

  it('sorts links_in deterministically', () => {
    const records = new Map<string, IndexRecord>();
    records.set('c', makeRecord('c', ['x']));
    records.set('a', makeRecord('a', ['x']));
    records.set('b', makeRecord('b', ['x']));
    records.set('x', makeRecord('x', []));

    computeReverseIndex(records);

    expect(records.get('x')!.links_in).toEqual(['a', 'b', 'c']);
  });
});
