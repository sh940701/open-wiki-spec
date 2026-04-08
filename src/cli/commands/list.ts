import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows list`.
 */
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import type { VaultIndex, IndexRecord } from '../../types/index.js';
import type { NoteType } from '../../types/notes.js';

export interface ListItem {
  id: string;
  type: NoteType;
  title: string;
  status: string;
  path: string;
  linkedFeature?: string;
  taskProgress?: { total: number; completed: number };
}

export interface ListResult {
  type: 'changes' | 'features' | 'all';
  items: ListItem[];
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List notes in the vault')
    .option('--changes', 'List only changes')
    .option('--features', 'List only features')
    .option('--json', 'Output result as JSON')
    .action(async (opts: { changes?: boolean; features?: boolean; json?: boolean }) => {
      try {
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const index = await buildIndex(vaultPath);

        const filterType = opts.changes ? 'changes' : opts.features ? 'features' : 'all';
        const result = listNotes(index, filterType);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.items.length === 0) {
            console.log('No notes found.');
          } else {
            for (const item of result.items) {
              const extra = item.taskProgress
                ? ` [${item.taskProgress.completed}/${item.taskProgress.total}]`
                : '';
              console.log(`  ${item.id.padEnd(24)} ${item.type.padEnd(8)} ${item.status.padEnd(12)} ${item.title}${extra}`);
            }
          }
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}

/**
 * List notes from the vault index.
 */
export function listNotes(index: VaultIndex, filterType: 'changes' | 'features' | 'all'): ListResult {
  const items: ListItem[] = [];

  for (const record of index.records.values()) {
    if (filterType === 'changes' && record.type !== 'change') continue;
    if (filterType === 'features' && record.type !== 'feature') continue;

    const item: ListItem = {
      id: record.id,
      type: record.type,
      title: record.title,
      status: record.status,
      path: record.path,
    };

    if (record.type === 'change') {
      item.linkedFeature = record.feature ?? record.features?.[0];
      item.taskProgress = {
        total: record.tasks.length,
        completed: record.tasks.filter((t) => t.done).length,
      };
    }

    items.push(item);
  }

  // Sort by status priority then by id
  const statusPriority: Record<string, number> = {
    in_progress: 0,
    planned: 1,
    proposed: 2,
    active: 3,
    draft: 4,
    applied: 5,
    archived: 6,
    deprecated: 7,
  };

  items.sort((a, b) => {
    const ap = statusPriority[a.status] ?? 99;
    const bp = statusPriority[b.status] ?? 99;
    if (ap !== bp) return ap - bp;
    return a.id.localeCompare(b.id);
  });

  return { type: filterType, items };
}
