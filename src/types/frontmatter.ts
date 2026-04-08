import type { NoteType, ChangeStatus, FeatureStatus, GeneralStatus } from './notes.js';

export interface BaseFrontmatter {
  type: NoteType;
  id: string;
  status: string;
  tags: string[];
}

export interface FeatureFrontmatter extends BaseFrontmatter {
  type: 'feature';
  status: FeatureStatus;
  systems: string[];
  sources: string[];
  decisions: string[];
  changes: string[];
}

export interface ChangeFrontmatter extends BaseFrontmatter {
  type: 'change';
  status: ChangeStatus;
  created_at: string;
  feature?: string;
  features?: string[];
  depends_on: string[];
  touches: string[];
  systems: string[];
  sources: string[];
  decisions: string[];
}

export interface SystemFrontmatter extends BaseFrontmatter {
  type: 'system';
  status: GeneralStatus;
}

export interface DecisionFrontmatter extends BaseFrontmatter {
  type: 'decision';
  status: GeneralStatus;
  features: string[];
  changes: string[];
}

export interface SourceFrontmatter extends BaseFrontmatter {
  type: 'source';
  status: GeneralStatus;
}

export interface QueryFrontmatter extends BaseFrontmatter {
  type: 'query';
  status: GeneralStatus;
  question?: string;
  consulted?: string[];
  features?: string[];
  systems?: string[];
}

export type Frontmatter =
  | FeatureFrontmatter
  | ChangeFrontmatter
  | SystemFrontmatter
  | DecisionFrontmatter
  | SourceFrontmatter
  | QueryFrontmatter;
