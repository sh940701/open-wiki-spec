/**
 * Query workflow orchestrator.
 * Coordinates search, context construction, noteworthiness assessment,
 * and note creation.
 */
import type { VaultIndex } from '../../../types/index.js';
import type { QueryRequest, QueryWorkflowResult } from './types.js';
import { querySearch, constructQueryContext } from './query-search.js';
import { assessNoteworthiness } from './noteworthiness.js';

/**
 * Run the query workflow.
 * 1. Search vault for related notes.
 * 2. Construct context for LLM.
 * 3. Assess whether findings warrant a Query note.
 * 
 * Note creation is deferred to the agent/CLI layer
 * since it requires user confirmation.
 */
export function queryWorkflow(
  request: QueryRequest,
  index: VaultIndex,
): QueryWorkflowResult {
  // Validate input
  if (!request.question || request.question.trim().length === 0) {
    throw new Error('Query question must not be empty');
  }

  // Phase 1: Search
  const searchResult = querySearch(request, index);

  // Phase 2: Build context
  const contextDocument = constructQueryContext(searchResult);

  // Phase 3: Noteworthiness assessment
  const assessment = assessNoteworthiness(request.question, searchResult);

  return {
    searchResult,
    contextDocument,
    assessment,
  };
}
