export { scanOpenSpec, findOpenSpecDir } from './scanner.js';
export { convertSpec, convertAllSpecs } from './spec-converter.js';
export { convertChange, convertAllChanges } from './change-converter.js';
export { convertConfigToSource } from './source-converter.js';
export { inferSystems, convertSystems, buildSystemRefMap, buildFeatureRefMap } from './system-inferrer.js';
export { planMigration, executeMigration, migrate } from './migrate.js';
export type {
  MigrateOptions,
  MigrationPlan,
  MigrationResult,
  MigrationStep,
  ConversionResult,
  ScanResult,
  ScannedSpec,
  ScannedChange,
  OpenSpecConfig,
  OpenSpecChangeMetadata,
} from './types.js';
