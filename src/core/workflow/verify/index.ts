export { verify } from './verify.js';
export type { VerifyOptions } from './verify.js';
export {
  checkFeatureCompleteness,
  checkChangeCompleteness,
  checkMinimumSections,
} from './completeness.js';
export {
  runOperationValidationMatrix,
  checkStaleBase,
  checkStatusTransition,
  checkSchemaVersionMatch,
  checkDriftForStatus,
  checkUnfilledApplyMarkers,
} from './correctness.js';
export {
  checkConflictsViaSequencing,
  checkDescriptionConsistency,
  checkDecisionConsistency,
  checkDependsOnConsistency,
} from './coherence.js';
export {
  duplicateIdCheck,
  missingIdCheck,
  unresolvedWikilinkCheck,
  ambiguousAliasCheck,
  orphanNoteCheck,
  archivePlacementCheck,
  invalidFrontmatterTypeCheck,
  titleIdCollisionCheck,
  resolveLink,
} from './vault-integrity.js';
