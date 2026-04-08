/** Discriminated union of all note types */
export type NoteType = 'feature' | 'change' | 'system' | 'decision' | 'source' | 'query';

/** Status values for Change notes */
export type ChangeStatus = 'proposed' | 'planned' | 'in_progress' | 'applied';

/** Status values for Feature notes */
export type FeatureStatus = 'active' | 'deprecated';

/** Status values for System, Decision, Source, Query notes */
export type GeneralStatus = 'active' | 'draft' | 'archived';
