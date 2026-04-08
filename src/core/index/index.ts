export { buildIndex, type BuildOptions } from './build.js';
export { scanVaultFiles, type FileEntry } from './scan.js';
export { readSchemaVersion } from './schema-version.js';
export {
  buildLookupMaps,
  resolveWikilink,
  isResolved,
  type LookupMaps,
  type WikilinkResolution,
  type WikilinkError,
} from './resolve.js';
export { computeReverseIndex } from './reverse.js';
export { detectDuplicateIds, buildWarnings } from './validate.js';
