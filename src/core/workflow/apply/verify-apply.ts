import type { PendingAgentOp, PostValidation, ApplyDeps } from './types.js';
import type { VaultIndex } from '../../../types/index-record.js';
import type { Requirement } from '../../../types/requirement.js';
import { computeRequirementHash } from './stale-checker.js';

/**
 * Verify and finalize after agent completes MODIFIED/ADDED content edits.
 * Called in Phase C after the agent has written content guided by pendingAgentOps.
 *
 * Uses preEditSnapshots (captured before Phase B) to verify the agent actually
 * changed the content. Does NOT compare the note against itself.
 */
export function verifyApply(
  changeId: string,
  changePath: string,
  pendingOps: PendingAgentOp[],
  preEditSnapshots: Map<string, Map<string, string>>,
  getRequirements: (featureId: string) => Map<string, Requirement> | undefined,
  deps: ApplyDeps,
): { success: boolean; postValidation: PostValidation[]; statusTransitioned: boolean; errors: string[] } {
  const errors: string[] = [];
  const allPostValidations: PostValidation[] = [];

  // Group pending ops by feature
  const byFeature = new Map<string, PendingAgentOp[]>();
  for (const op of pendingOps) {
    const group = byFeature.get(op.featureId) ?? [];
    group.push(op);
    byFeature.set(op.featureId, group);
  }

  for (const [featureId, ops] of byFeature) {
    const currentReqs = getRequirements(featureId);
    if (!currentReqs) {
      errors.push(`Feature "${featureId}" not found during verify`);
      continue;
    }

    const snapshot = preEditSnapshots.get(featureId) ?? new Map();

    for (const op of ops) {
      const entry = op.entry;

      if (entry.op === 'MODIFIED') {
        const req = currentReqs.get(entry.targetName);
        if (!req) {
          allPostValidations.push({
            entry,
            valid: false,
            error: `Requirement "${entry.targetName}" MUST exist after MODIFIED`,
          });
          errors.push(`Post-validation: Requirement "${entry.targetName}" MUST exist after MODIFIED`);
          continue;
        }

        const currentHash = computeRequirementHash(req);
        const snapshotHash = snapshot.get(entry.targetName);
        const changedFromSnapshot = snapshotHash ? currentHash !== snapshotHash : true;
        const changedFromBase = entry.baseFingerprint ? currentHash !== entry.baseFingerprint : true;
        const hashChanged = changedFromSnapshot && changedFromBase;

        allPostValidations.push({
          entry,
          valid: true,
          hashChanged,
          error: !hashChanged
            ? `Requirement "${entry.targetName}" content_hash unchanged after MODIFIED (no-op warning)`
            : undefined,
        });

        if (!hashChanged) {
          errors.push(`Post-validation: MODIFIED requirement "${entry.targetName}" content_hash unchanged (no-op)`);
        }
      }

      if (entry.op === 'ADDED') {
        const exists = currentReqs.has(entry.targetName);
        allPostValidations.push({
          entry,
          valid: exists,
          error: !exists
            ? `Requirement "${entry.targetName}" MUST exist after ADDED`
            : undefined,
        });
        if (!exists) {
          errors.push(`Post-validation: Requirement "${entry.targetName}" MUST exist after ADDED`);
        }
      }
    }
  }

  let statusTransitioned = false;

  if (errors.length === 0) {
    // Transition status to 'applied'
    const content = deps.readFile(changePath);
    const updated = content.replace(
      /^(status:\s*).+$/m,
      '$1applied',
    );
    deps.writeFile(changePath, updated);
    statusTransitioned = true;
  }

  return { success: errors.length === 0, postValidation: allPostValidations, statusTransitioned, errors };
}
