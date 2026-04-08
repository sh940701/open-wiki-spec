# open-wiki-spec Design Brief

This document is the single reference document that explains the product concept, design principles, sources of inspiration, relationship to `OpenSpec`, and recommended information architecture for `open-wiki-spec` in one place. It is written so that this document alone can be injected into a fresh session and still give full context about the product's purpose and design direction.

## 1. What This Is

`open-wiki-spec` is a `code management wiki engine` that uses an `Obsidian` vault as its single source of truth.

This tool is not just a document storage system. Its goals are:

- Create a sustainable, structured knowledge layer for a codebase.
- Allow an LLM/agent to work from an already organized and linked wiki instead of repeatedly scanning the filesystem from scratch and reconstructing context every time.
- Manage the current canonical system description, proposed changes, decisions, supporting sources, and exploration notes as a single graph.
- Make Obsidian the human-facing interface for reading and exploration, while the CLI/agent becomes the workflow engine that reads and updates that wiki.

In one sentence:

> `open-wiki-spec` combines OpenSpec's way of thinking about change management with the LLM-maintained wiki pattern to manage codebase knowledge around Obsidian.

## 2. Why Use This

A typical agent workflow usually looks like this:

1. Read the current filesystem.
2. Find relevant files.
3. Reconstruct the context again from scratch.
4. Perform the task.

This works, but it has clear problems:

- Context is easy to lose between sessions.
- Related features, past decisions, similar existing implementations, and design constraints must be rediscovered every time.
- Knowledge stays trapped in chats instead of accumulating as a structured asset.
- The current canonical state, the intended change, the reason behind it, and the supporting evidence are not collected in one place.

`open-wiki-spec` addresses this by maintaining accumulated knowledge about code and documents as a typed wiki inside an Obsidian vault.

With this structure, an agent works like this:

1. Instead of blindly scanning the filesystem, it finds related `Feature`, `System`, `Decision`, `Source`, and `Change` notes in the vault.
2. It reads already-curated summaries, links, impact scopes, and source documents.
3. It performs proposing, changing, verifying, and applying work on top of that wiki.
4. It writes the results back into the wiki, lowering the cost of future sessions.

The core value is `knowledge accumulation` and `reuse of working context`.

## 3. What Documents Inspired This

This product draws inspiration from two main sources.

### 3.1 Karpathy's LLM Wiki Pattern

Primary inspiration:

- [Karpathy, "LLM Wiki" gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

The key ideas borrowed from that document are:

- An LLM does not have to behave like a system that re-searches raw sources every time; it can instead maintain a continuously updated wiki.
- A wiki should not be a temporary query-time RAG artifact; it should be a persistent artifact that accumulates and gets refined over time.
- Operational files such as `index.md`, `log.md`, and `schema` make the wiki explorable not only for humans but also for agents.
- Obsidian is not just a note-taking app; it can become the IDE where humans inspect a knowledge graph maintained by an LLM.

Interpreted in the context of this product, Karpathy's well-known framing becomes:

> Obsidian is the IDE, the LLM is the programmer, and the wiki is the codebase-level knowledge layer.

### 3.2 OpenSpec's spec/change Workflow Pattern

Reference product:

- `OpenSpec`

The key ideas borrowed from OpenSpec are:

- Separate the current state from proposed changes.
- A change should be an independent work unit.
- A change should carry evidence, impact scope, and a validation approach.
- Work should make it possible to track what the canonical state is now and what is being changed.
- Agent workflows are better when clearly divided into steps such as `propose`, `continue`, `apply`, and `verify`.

In short, `open-wiki-spec` places OpenSpec's change-management mindset on top of Karpathy's wiki pattern.

## 4. What It Shares with OpenSpec

`open-wiki-spec` is philosophically very close to OpenSpec.

The shared properties are:

- It separates the canonical current state from proposed changes.
- It manages changes as identifiable independent units.
- It structures agent workflows into explicit steps.
- It requires validation before apply.
- It connects source material and impact scope.
- It reduces knowledge bookkeeping costs by letting the agent handle them instead of the human doing everything manually.
- It preserves project knowledge as long-lived artifacts instead of leaving it in transient chat.

In other words, `open-wiki-spec` shares OpenSpec's way of framing the problem.

## 5. How It Differs from OpenSpec

가장 중요한 차이는 UI가 아니다. 차이의 핵심은 `knowledge storage and access model`이다.

또한 이 전환은 `OpenSpec`을 `Obsidian` 폴더 구조로 그대로 옮기는 `무손실 변환`이 아니다. 이것은 Obsidian을 사람과 에이전트가 함께 사용하는 1차 작업면으로 놓고 다시 설계한 `Obsidian-first redesign`이다. 따라서 일부 OpenSpec 고유의 artifact shape는 그대로 유지되지 않지만, 정밀 delta 추적과 정형 artifact workflow 자체는 가능한 한 보존한다.

### OpenSpec

- Canonical state lives in a fixed filesystem structure.
- Directories such as `specs/`, `changes/`, and `archive/` are central to how the system works.
- The agent reads the current project directory and interprets that structure.
- The core concept is the "spec document."

### open-wiki-spec

- Canonical state lives in a graph of markdown notes inside an `Obsidian vault`.
- Directories are secondary structure; the real core is note type, frontmatter, wikilinks, and backlinks.
- The agent reads the structured knowledge layer in the vault before it reads raw project files.
- The `Feature` note plays the role of the canonical spec.

무엇을 잃는가:

- OpenSpec의 고정 디렉토리 중심 탐색 감각
- `spec.md`와 `change.md`를 거의 그대로 따르는 직접적인 파일 포맷 호환성
- archive-first 이동을 전제로 한 단순한 완료 모델

무엇을 얻는가:

- rename, move, archive 이후에도 유지되는 `id` 중심 안정성
- wikilink, backlink, typed note를 활용한 더 풍부한 graph signal
- 개별 `Change`보다 오래 살아남는 `Decision` note 수명
- `Feature`의 machine-verifiable `Requirements`, `Change`의 machine-readable `Delta Summary`, `depends_on`/`touches` 같은 sequencing metadata를 통해 보존되는 정형 workflow

In one sentence:

- `OpenSpec` is a `filesystem-native spec tool`
- `open-wiki-spec` is an `Obsidian-native knowledge workflow engine`

## 6. What Concepts It Keeps and What It Changes

### 6.1 Concepts Kept As-Is

The following concepts are kept almost directly:

- Separation of current state and proposed change
- A lifecycle for changes
- Evidence-based work
- Explicit validation stages
- Traceable work state
- Agent-friendly operational structure
- An operating pattern built around `index` and `log`

### 6.2 Concepts Intentionally Changed

The following are intentionally changed.

#### A. `spec` is not an independent file type

대신 `Feature` note가 canonical spec 역할을 한다. 다만 이것이 느슨한 위키 페이지가 된다는 뜻은 아니다. `Feature`는 최소 구조를 유지하면서, 별도의 `## Requirements` 섹션을 통해 기계적으로 검증 가능한 정본 spec contract를 계속 가진다.

Reason:

- In Obsidian, a living canonical document for a feature is much more natural than a separate spec file.
- It is easier for humans to read, edit, and explore by following links.
- It is easier to connect feature documents, changes, decisions, and evidence inside a single knowledge graph.
- OpenSpec 수준의 정밀한 requirement 검증을 완전히 버리지 않고, `Feature` 내부 contract로 흡수할 수 있다.

Advantages:

- Easier to read
- More natural graph exploration
- Easier for the agent to reconstruct the current state
- `SHALL`/`MUST`와 `WHEN`/`THEN` scenario를 포함하는 requirement block을 유지하여 machine-verifiable spec 성격을 보존할 수 있다

#### B. `Task` is not a separate note type

Instead, tasks remain as a checklist inside a `Change`.

Reason:

- If tasks are broken into separate notes, the graph becomes overly fragmented.
- It is more practical to keep the purpose, impact, validation, and progress state of a change together in one note.

Advantages:

- Less graph pollution
- Both humans and agents can understand current work state in one place
- Prevents Obsidian from devolving into an issue tracker clone

#### C. Prefer status lifecycle over archive-first file movement

완료된 `Change` note는 먼저 `status: applied`로 `04-changes/`에 남는다. 그 다음 일정 보존 기간이 지난 뒤나 명시적인 archive action이 있을 때 `99-archive/`로 이동한다. 즉, v1은 `status lifecycle`과 `file movement lifecycle`을 분리한 `hybrid lifecycle`을 채택한다.

Reason:

- File moves in Obsidian create link-management cost and context loss.
- Keeping applied changes explorable is better for later decision reconstruction.
- 반대로 `applied` note가 계속 쌓이면 폴더 탐색이 오염되고, backlink가 과도해지며, similarity scan에도 노이즈가 커진다. 따라서 "영구 잔류"도 기본 정책이 되어서는 안 된다.
- archive 이동 이후에도 canonical identity는 `id`이므로 링크 안정성은 유지할 수 있다.

Advantages:

- Change history remains continuous in the active working area immediately after apply
- 일정 시간이 지난 뒤에는 archive hygiene를 회복할 수 있다
- `id` 기반이므로 move 이후에도 machine reference 안정성이 유지된다

#### D. Use Plain Vault Mode instead of depending on Obsidian runtime/app APIs

`open-wiki-spec` reads and writes markdown/frontmatter/wikilinks directly from the Obsidian vault directory.

Reason:

- It works much better with CLI usage, automation, CI, and agent tooling.
- It can run even when the Obsidian app is closed.
- A plugin/API bridge is not required to build a strong enough system.

Advantages:

- Simpler implementation
- Better portability
- Better automation stability
- Easier distribution

## 7. The Current Limitations of OpenSpec and Why They Matter

OpenSpec already carries good discipline in principle:

- Before creating new work, it should investigate existing specs/changes.
- If similar work already exists, it should add onto the existing canonical state or continue the existing change instead of starting from scratch.
- A change should be managed together with context, impact scope, and validation planning.

The problem is that these rules are not enforced strongly enough at runtime. In practice, the flow often looks like this:

1. The agent reads the filesystem.
2. The LLM is asked, "Check whether anything similar already exists."
3. The model infers candidates based on current session context and search quality.
4. A new change is created or an existing spec is modified based on that result.

The limitations of this structure are:

- Similarity detection depends too much on prompt instructions and free-form model reasoning instead of on a mechanically enforced retrieval stage.
- Results can vary from session to session because the files read, search range, and summaries can vary.
- It can easily miss work that is effectively the same even if the names differ but the system, intent, or decision context is shared.
- The process of finding existing related material is not a transparent scoring process; it is scattered across opaque model judgment.
- This can lead to duplicate changes, missed related features, collisions with already active changes, and weakened traceability of evidence.

In one sentence:

> OpenSpec's limitation is not that its philosophy is weak, but that similarity detection and pre-investigation are too often delegated to non-deterministic LLM behavior instead of being enforced as product behavior.

## 8. How Obsidian-Based open-wiki-spec Solves This

`open-wiki-spec` does not solve this merely because it uses Obsidian. It solves it because it turns knowledge into a typed graph and makes similarity scan a mandatory preflight step before `propose`.

### 8.1 Similarity Scan Is Not the Same Thing as Vector Search

In this document, `similarity scan` does not mean simple embedding search. More broadly, it means the step that structurally finds existing `Feature`, `Change`, `System`, `Decision`, and `Source` notes that overlap with or are close to a new request before a new change is created.

That step can be composed of three layers:

- Structure-based search: title, aliases, tags, frontmatter links, backlinks, status, and shared system/feature/source relationships
- Text-based search: full text, phrase matches, section matches, keyword ranking
- Meaning-based search: embeddings, vector similarity, semantic reranking

So `similarity scan` should be understood not as `vector DB`, but as a pre-investigation stage that collects and scores related candidates.

### 8.2 Enforce Preflight Before `propose`

In `open-wiki-spec`, `propose` must not immediately create a new `Change`. It must first run the following preflight:

1. Take the user's request as input.
2. Search the vault for related `Feature`, `Change`, `System`, `Decision`, and `Source` candidates.
3. Score candidates using signals such as exact title match, alias match, same system, active change overlap, shared source, backlinks, and full-text hits.
4. Show the top candidates together with the reasons they were matched.
5. Only then decide one of the following four paths:

- attach to an existing `Feature`
- continue an existing `Change`
- create a completely new `Feature` and new `Change`
- stop and ask for user confirmation because the candidates conflict

The core principle of this structure is:

> The LLM is not the search engine. The system gathers and narrows candidates first, and the LLM interprets on top of that.

### 8.3 The Goal of Preflight Is Not Just “Is There Something Related?” but “Where Should This Attach?”

The goal of similarity scan is not simply to answer, "Does something similar exist?" Its real purpose is to determine which of the following paths should be taken:

- Update an existing `Feature` and create a new `Change`
- Update an existing `Feature` and continue an existing `Change`
- Create a completely new `Feature` and a new `Change`
- Hold creation because related candidates are too ambiguous and require user confirmation

The recommended default rules are:

- If this is an extension of the same user-facing feature, update the existing `Feature`.
- If a separate work unit must be tracked, create a new `Change`.
- If an active `Change` with the same purpose already exists, continue that `Change` instead of creating a new one.
- If the work is a distinct feature from the user's perspective, create a new `Feature`.

In other words, the default should be to keep `Feature` as the canonical state and track work history through `Change`, rather than constantly splitting the canonical state across new feature notes.

### 8.4 The Decisive Advantage of a Typed Graph

Once an Obsidian vault is the single source of truth, the system has far more signals available for similarity judgment than OpenSpec does:

- note type
- title
- aliases
- tags
- `systems`, `sources`, `changes`, `decisions` frontmatter
- backlinks
- linked notes
- active/inactive/applied status
- body text

These signals allow the system to move beyond simple filename comparison and more reliably identify:

- similar features inside the same system
- changes that share the same source
- already active related changes
- features linked to the same decisions

### 8.5 Obsidian Does Not Need Built-In Vector Search

Because `open-wiki-spec` assumes `Plain Vault Mode`, the Obsidian app itself does not need to provide a built-in vector DB.

What matters is:

- Obsidian is the UI for human reading and exploration.
- `open-wiki-spec` is the workflow engine that reads raw markdown/frontmatter/wikilinks from the vault directory.
- If needed, `open-wiki-spec` can build its own search index and vector index separately.

In short, control over search and similarity judgment belongs to `open-wiki-spec`, not to the Obsidian app.

## 9. Phased Plan for Similarity Scan: v1 and v2

### 9.1 v1: Deterministic Similarity Scan Without Vectors

The goal of v1 is not to add semantic search immediately. The goal is to make pre-investigation quality deterministically better than OpenSpec.

v1 uses the following signals:

- exact title match
- alias match
- same system match
- same feature link match
- active change overlap
- shared source or decision
- backlink/shared-link proximity
- full-text keyword ranking

The nature of v1:

- deterministic
- explainable
- debug-friendly
- low implementation cost

The strengths of v1:

- You can explain why a candidate was surfaced.
- Results do not swing dramatically between sessions.
- It does not depend on embedding quality or external service state.
- As long as note schema and frontmatter are maintained well, it is already much more stable than OpenSpec's prompt-driven search.

Key judgment:

> v1 is not a "still incomplete because it has no vectors" version. It is already a strong operating version built on structured metadata and lexical retrieval.

#### Recommended Shape of v1 Search and Scoring Logic

In v1, retrieval results must not be returned as free-form prose. They must be returned as a structured candidate list.

Recommended pipeline:

1. Normalize the input request into a query object for search.
2. Perform first-pass lexical retrieval across `Feature`, `Change`, `System`, `Decision`, and `Source`.
3. Expand the graph one hop from the first-pass candidates.
4. Score candidates using the signals below.
5. Return the top candidates together with reasons.
6. Normalize the final classification into one of `existing_feature`, `existing_change`, `new_feature`, or `needs_confirmation`.

v1 default scoring weights (adjustable per vault via `conventions.md`, but these are the shipped defaults, not mere examples):

- exact title match: `+40`
- alias match: `+35`
- same system match: `+20`
- same feature link match (bidirectional — Feature→Change and Change→Feature): `+20`
- active change overlap: `+25`
- shared source: `+10`
- shared decision: `+10`
- backlink/shared-link proximity: `+10`
- strong full-text match: `+15`

Example output format:

```json
{
  "query": "add passkey login",
  "classification": "existing_feature",
  "candidates": [
    {
      "note": "[[Feature: Auth Login]]",
      "score": 87,
      "reasons": [
        "alias match: login",
        "same system: authentication",
        "strong full-text hit: passkey"
      ]
    },
    {
      "note": "[[Change: Improve Authentication UX]]",
      "score": 61,
      "reasons": [
        "active change overlap",
        "same system",
        "shared source"
      ]
    }
  ]
}
```

Why this matters:

- Humans can read why a candidate was surfaced.
- The main agent can make its next decision more easily.
- Failure cases are easier to debug and scoring rules are easier to tune.

#### v1 Document Update Rules

When a relevant existing feature is identified, the recommended default behavior is:

- If an existing `Feature` is the canonical spec, update that document.
- If a new work unit is needed, create a new `Change` and link it to that `Feature`.
- If an active `Change` with the same purpose already exists, continue that `Change` instead of creating a new one.
- Only create a new `Feature` when the work is truly independent.

In short:

> The default is not "keep creating new things and only link them loosely," but "update the canonical `Feature` and keep work history in `Change`."

### 9.2 v2: Add Embeddings as a Secondary Semantic Rerank Signal

In v2, embedding/vector search can be added. Even then, vectors should be treated only as a `secondary signal`, not the sole basis of judgment.

Expected improvements in v2:

- Better detection of naming mismatches
- Better matching of features/changes with the same intent but different wording
- Better support for meaning hidden inside long bodies of text
- Improved recall by adding semantic reranking after lexical ranking

Principles of v2:

- Base retrieval must still be structure-based and text-based.
- Vector score is a bonus signal, not a single decision-maker.
- Explainability must be preserved.

Key judgment:

> v2 does not replace v1. It extends v1 by adding semantic recall to reduce retrieval misses.

### 9.3 v1 Execution Model: Claude Code Main Agent + Retrieval Subagent

In v1, similarity scan should not be handled as free-form reasoning by the main agent. Instead, the recommended operating model is to delegate it explicitly to a `retrieval subagent`.

Recommended role split:

- Main agent:
  - interprets the user's request
  - instructs the retrieval subagent to search
  - reads the structured candidate list returned by the subagent
  - makes the final decision among `existing_feature`, `existing_change`, `new_feature`, and `needs_confirmation`
  - determines whether to create a `Change` or update a `Feature`

- Retrieval subagent:
  - reads the vault index
  - performs lexical retrieval and graph expansion
  - performs scoring and reason formatting
  - returns only the structured candidate list

Core principles:

- The subagent handles search, scoring, AND classification. It returns a fully classified result including the recommended `classification` and `confidence`. The main agent trusts this classification by default but may override it.
- The main agent handles final interpretation and workflow decisions (create/update/continue).
- Classification ownership belongs to the retrieval engine, not the workflow layer. The workflow layer consumes classification, not reimplements it.
- Separating search concerns from authoring concerns reduces non-determinism.

Why this structure is recommended:

- When search and document generation are mixed together, prompt drift increases.
- A retrieval-focused subagent is more stable because it has a narrower mission.
- It becomes easier to enforce a standard output format for search results.
- Scoring rules and retrieval strategy can be improved independently later.

### 9.4 v1 Product Scope: Claude Code Only

The initial version should have a clearly limited scope.

- v1 supports only the `Claude Code` environment.
- v1's agent workflow assumes the Claude Code operating model where the main agent delegates retrieval to a subagent.
- Broad compatibility with other agent runtimes such as Codex, Cursor, Gemini CLI, or generic MCP hosts is not a v1 goal.

Reasons for this decision:

- Trying to support every runtime from the beginning creates too much abstraction cost.
- It is better to stabilize search/score/propose in one environment first.
- The initial product quality benefits from hardening the prompt contract and subagent contract specifically for `Claude Code`.

In short:

> v1 should not be "a universal tool that works everywhere." It should be "the first operating version that works well in Claude Code."

## 10. Retrieval / Index Contract

This section defines what the `retrieval subagent` reads, what format it returns, and what rules it uses to finish classification. v1 implementation should begin from this contract.

### 10.1 Relationship Between Source of Truth and Index

- Canonical data always lives in raw vault markdown files.
- The index is only a derived artifact for faster search; it is not canonical.
- Even if the index is damaged or stale, it must be reconstructable by rescanning raw markdown.

Core principle:

> The vault is the truth. The index is disposable cache.

### 10.1.1 Schema Version and Migration Contract

Note contract는 고정 불변이 아니라 versioned contract로 취급해야 한다.

- Vault 전체의 schema version은 `wiki/00-meta/schema.md`에서 관리한다.
- `schema.md`는 현재 schema version, migration note, deprecated field, effective date를 선언한다.
- Index build는 로드한 `schema_version`을 함께 기록해야 한다.
- `verify`는 현재 vault note contract와 `schema.md`의 선언이 불일치하면 `schema mismatch`를 감지하고 보고해야 한다.
- v1의 migration 기본 원칙은 additive-first이다. 파괴적 migration은 명시적 사용자 확인 없이는 자동 수행하지 않는다.

### 10.2 v1 Index Refresh Policy

In v1, simplicity and determinism should be prioritized over complex long-lived caching.

- Run a fresh vault scan at the start of `propose`, `query`, and `verify`.
- Scan target: `wiki/**/*.md`
- The default v1 index is an in-memory index.
- Disk cache is an optional optimization, not a runtime requirement.
- If disk cache is used, invalidate it using `mtime + file size + content hash`.

Reasons:

- v1 prioritizes retrieval quality and explainability.
- Returning wrong candidates because of stale index is worse than rescanning every time.
- In early vault sizes, full-scan cost is likely acceptable.

### 10.3 Recommended Shape of an Index Record

In v1, every typed note should be parsed into at least the following fields:

```json
{
  "schema_version": "2026-04-06-v1",
  "id": "feature-auth-login",
  "type": "feature",
  "title": "Feature: Auth Login",
  "aliases": ["login auth"],
  "path": "wiki/03-features/auth-login.md",
  "status": "active",
  "tags": ["feature"],
  "systems": ["system-authentication"],
  "sources": ["source-auth-prd-2026-04-05"],
  "decisions": ["decision-session-strategy"],
  "changes": ["change-add-passkey-login"],
  "depends_on": [],
  "touches": ["feature-auth-login", "system-authentication"],
  "links_out": ["feature-auth-login", "system-authentication"],
  "links_in": ["change-add-passkey-login"],
  "headings": ["Purpose", "Current Behavior", "Constraints", "Known Gaps", "Requirements"],
  "requirements": [
    {
      "key": "feature-auth-login::Passkey Authentication",
      "name": "Passkey Authentication",
      "normative": "The system SHALL allow a registered user to authenticate with a passkey.",
      "scenarios": [
        { "name": "Successful passkey sign-in", "raw_text": "WHEN a registered user selects passkey login THEN the system MUST begin WebAuthn authentication." }
      ],
      "content_hash": "sha256:abc123..."
    }
  ],
  "delta_summary": [
    {
      "op": "ADDED",
      "target_type": "requirement",
      "target_name": "Passkey Authentication",
      "target_note_id": "feature-auth-login",
      "base_fingerprint": null,
      "description": ""
    }
  ],
  "tasks": [],
  "raw_text": "...",
  "content_hash": "..."
}
```

`links_in` is computed afterward as a reverse index.

`requirements`는 `Feature`에만, `delta_summary`와 `depends_on`은 주로 `Change`에만 의미가 있다. 그러나 index shape 자체는 note type별 minimum contract를 공통 필드 집합으로 파싱할 수 있어야 한다.

Requirement identity는 전역 이름이 아니라 `feature_id + requirement_name`으로 구성된 composite key다. 위 예시의 `"key": "feature-auth-login::Passkey Authentication"`이 canonical identifier이며, 같은 이름의 requirement라도 다른 Feature에 속하면 다른 identity를 가진다.

`content_hash`는 requirement body(normative statement + scenarios)의 정규화된 해시값이다. 이 값은 `Delta Summary`의 `base_fingerprint`와 대조하여 stale-change를 감지하는 데 사용된다.

### 10.4 Query Object Contract

The main agent should not send only natural language to the retrieval subagent. It should first normalize the request into a query object.

Recommended format:

```json
{
  "intent": "add",
  "summary": "add passkey login",
  "feature_terms": ["passkey", "login"],
  "system_terms": ["authentication"],
  "entity_terms": ["webauthn"],
  "status_bias": ["active", "proposed", "planned", "in_progress"]  // defaults per intent: "add"/"modify" → active+proposed+planned+in_progress; "remove" → active+applied; "query" → all statuses
}
```

Why this format matters:

- It separates retrieval from authoring.
- It makes search more consistent for the same request.
- The input contract can remain stable even if scoring rules change later.

### 10.5 Classification / Threshold Contract

In v1, it is not enough to simply return plausible candidates. The retrieval subagent should return classification hints that the main agent can immediately use.

Recommended default classification rules:

- `existing_change`
  - top candidate is an active `Change`
  - score `>= 75`
  - score gap from the second candidate `>= 15`

- `existing_feature`
  - top candidate is a `Feature`
  - score `>= 70`
  - no strong active `Change` candidate exists within `10` points of the top candidate

- `new_feature`
  - top `Feature` and `Change` candidates are both below `45`

- `needs_confirmation`
  - top two candidates are both `>= 60` and their score gap is under `10`
  - a `Feature` and an active `Change` both match strongly and conflict
  - index-quality issues exist, such as duplicate IDs, ambiguous wikilinks, or missing targets
  - sequencing severity is `conflict_candidate` or `conflict_critical` against an existing active `Change`

Core principles:

- Thresholds are heuristics, but they must be documented.
- Ambiguous cases should not be forced into automatic classification; they should be escalated to `needs_confirmation`.

### 10.5.1 Parallel Change Sequencing Contract

Similarity scan은 "무엇이 관련 있는가"를 판단한다. Sequencing contract는 그와 별도로 "무엇이 먼저여야 하는가"와 "무엇이 병렬 충돌하는가"를 판단한다.

- `depends_on`은 명시적인 선행 관계를 표현한다.
- `touches`는 해당 `Change`가 영향을 주는 `Feature`/`System` surface를 명시한다.

#### Touches Severity Model

Preflight와 `verify`는 active `Change`들 사이에서 `depends_on`과 `touches`를 함께 읽고 다음 severity 중 하나로 분류해야 한다.

| Severity | 조건 | 행동 |
|----------|------|------|
| `parallel_safe` | touch 겹침 없음 | 자동 진행 가능 |
| `needs_review` | 같은 `System`을 touches하지만 다른 `Feature` | 사용자 확인 권장, 자동 진행은 가능하되 warning 표시 |
| `conflict_candidate` | 같은 `Feature`를 touches | 사용자 확인 필요, auto-apply 차단 |
| `blocked` | `depends_on` target이 미완료 | hard block, 진행 불가 |

same-System overlap은 기본적으로 `needs_review`다. `advisory_overlap`으로 완화하려면 공존 근거(예: 독립적인 기능 영역임을 명시하는 코멘트)가 필요하다.

#### Requirement-Level Conflict Model

`touches` severity는 Feature/System 수준의 충돌을 감지한다. 더 정밀한 감지를 위해, 두 active `Change`의 `Delta Summary`가 같은 Feature 내의 같은 requirement를 건드리는 경우를 별도로 감지한다.

| Change A | Change B | 판정 |
|----------|----------|------|
| MODIFY req X | MODIFY req X | `conflict_critical` |
| MODIFY req X | REMOVE req X | `conflict_critical` |
| RENAME req X | MODIFY req X (old name) | `conflict_critical` |
| ADD req X | ADD req X (same name) | `conflict_critical` |

`conflict_critical`은 `conflict_candidate`보다 강하며, 사용자 확인 없이는 어느 쪽도 apply할 수 없다.

#### Deterministic Ordering

여러 unblocked `Change`가 있을 때 적용 순서를 결정적으로 계산해야 한다.

1. `depends_on`으로 partial order를 생성한다 (topological sort).
2. 같은 레벨의 unblocked peers 사이에서는 `(created_at, change_id)` tuple 기준 오름차순 (FIFO + deterministic tiebreak).
3. `conflict_candidate` 또는 `conflict_critical` 관계에 있는 peers는 사용자 선택이 필요하다.
4. 사용자가 명시적으로 priority를 부여하면 그것이 최우선이다.

- `depends_on` target이 존재하지 않거나, 아직 완료되지 않은 선행 작업을 필요로 하는데 현재 `Change`가 `in_progress` 또는 `applied`로 앞서 나가 있으면 sequencing error로 보고해야 한다.

### 10.5.2 Post-Classification Action Contract

Each classification must map directly to the next workflow action.

- `existing_change`
  - Use the existing active `Change` as the current work target.
  - If needed, also read the linked `Feature` and continue into continue/apply.

- `existing_feature`
  - Use the existing `Feature` as the canonical target.
  - If a new work unit is needed, create a new `Change` and connect it to that `Feature`.

- `new_feature`
  - Create a new `Feature` note first.
  - Then create a new `Change` and connect it to the new `Feature`.

- `needs_confirmation`
  - Stop automatic generation/update.
  - Show the top candidates and conflict reasons to the user and request a manual choice.

Core principle:

> Classification is not just a label. It must be a workflow switch that determines the next create/update action.

### 10.6 Retrieval Subagent Output Contract

The retrieval subagent must return a structured result with the following fields:

```json
{
  "query": "add passkey login",
  "classification": "existing_feature",
  "confidence": "high",       // "high" = top score >= 75 and gap >= 15; "medium" = top >= 60; "low" = top < 60
  "sequencing": {
    "status": "parallel_safe",
    "related_changes": ["change-improve-auth-copy"],
    "reasons": [
      "shared system but non-overlapping touches",
      "no blocking depends_on edge"
    ]
  },
  "candidates": [
    {
      "id": "feature-auth-login",
      "type": "feature",
      "title": "Feature: Auth Login",
      "score": 87,
      "reasons": [
        "alias match: login",
        "same system: authentication",
        "strong full-text hit: passkey"
      ]
    }
  ],
  "warnings": []
}
```

`warnings` should contain things such as:

- duplicate id detected
- unresolved wikilink
- ambiguous alias collision
- stale cache ignored and full scan used
- schema mismatch between parsed notes and `wiki/00-meta/schema.md`
- active change touch-surface collision without explicit dependency

Why this contract matters:

- The main agent can parse retrieval results easily.
- Humans can understand and correct failure causes.
- Retrieval can be tested independently.

### 10.7 Wikilink / Alias -> ID Normalization Rule

Relationship fields in raw notes may be stored as human-readable wikilinks. But internally, retrieval and verify must always operate by `id`.

Recommended normalization order:

1. exact match against the note title targeted by the wikilink
2. if no title match exists, exact match against alias
3. if multiple alias matches exist, raise an ambiguous error
4. if the target note has no `id`, raise an invalid target error
5. when resolved successfully, store the target's `id` in the internal index

Core principles:

- Humans write references as wikilinks.
- Machines store references as `id`.
- Ambiguous title/alias matches must not be guessed automatically.
- Wikilinks inside fenced code blocks (`` ``` ``) must be ignored during extraction, matching Obsidian's behavior.

Why this rule matters:

- Note titles and filenames can change.
- Aliases are useful for search assistance but weak as canonical identity.
- Internal representation must be unified around `id` for retrieval and verify to stay stable.

### 10.8 Verify Dimensions and Vault Integrity Contract

`verify`는 단순 lint가 아니라 OpenSpec의 검증 감각을 가져온 3차원 검증과 vault integrity 검사를 함께 수행해야 한다.

권장 검증 차원은 다음과 같다.

- `Completeness`
  - 필수 섹션이 모두 존재하는가
  - `Feature`에 machine-verifiable `Requirements`가 존재하는가
  - `Change`에 `Delta Summary`, `Tasks`, `Validation`이 존재하는가
  - 필요한 `Decision`, `System`, `Source` 링크가 누락되지 않았는가

- `Correctness`
  - wikilink와 frontmatter reference가 실제 note와 일치하는가
  - `Delta Summary`가 실제 canonical update 내용과 일치하는가
  - status transition이 허용된 경로를 따르는가
  - `schema_version`과 note contract가 일치하는가
  - status에 비추어 vault/code drift가 허용 가능한 수준인가

- `Coherence`
  - 서로 충돌하는 `Decision`이나 `Feature` 설명이 없는가
  - `depends_on`과 `touches`가 전체 active change set에서 일관된가
  - parallel change가 동일한 touch surface를 두고 무질서하게 경쟁하지 않는가
  - `Feature`, `Change`, `Decision`, `System` 사이의 설명이 서로 모순되지 않는가

#### Operation Validation Matrix

`verify`는 `applied` 상태의 `Change`에 대해 `Delta Summary`의 각 entry를 대상 `Feature`와 대조하여 다음 matrix를 기계적으로 검증해야 한다.

| Operation | Before Apply | After Apply |
|-----------|-------------|-------------|
| ADDED | requirement MUST NOT exist in Feature | requirement MUST exist |
| MODIFIED | requirement MUST exist | requirement MUST exist (content_hash changed) |
| REMOVED | requirement MUST exist | requirement MUST NOT exist |
| RENAMED | old name MUST exist, new MUST NOT | old MUST NOT exist, new MUST exist |

`MODIFIED`의 "updated" 판정 기준은 requirement의 `content_hash`다. apply 전후의 hash가 동일하면 실질적 변경이 없는 것이므로 warning을 보고한다.

#### Stale-Change Detection

`Delta Summary`의 각 `MODIFIED`, `REMOVED`, `RENAMED` entry에는 `base_fingerprint`가 기록되어야 한다. 이것은 해당 entry가 작성된 시점의 대상 requirement `content_hash`다.

apply 시점에 대상 requirement의 현재 `content_hash`가 `base_fingerprint`와 다르면, 다른 `Change`가 먼저 적용되어 base가 변경된 것이다. 이 경우:

- `verify`는 `stale_base` warning을 보고한다.
- auto-apply는 차단된다.
- 사용자가 현재 상태를 확인하고 `Delta Summary`를 갱신하거나, 충돌을 해결한 뒤에만 apply할 수 있다.

이것은 OpenSpec의 stale-base 검출과 동등한 안전성을 제공한다.

#### Vault Integrity

`Vault integrity` 검사 항목은 최소 다음을 포함해야 한다.

- duplicate or missing `id`
- unresolved wikilink
- ambiguous alias/title collision
- schema mismatch
- invalid frontmatter type or field shape
- orphan note
- broken `depends_on` target
- archive placement rule violation
- stale `base_fingerprint` in active `Change`
- requirement-level conflict across active `Change` notes

## 11. Identity / Drift Contract

This section defines what note identity is, how rename/move should behave, and how the system should interpret drift between the vault and code.

### 11.1 Canonical Identity Is `id`

The canonical identity of a typed note is not its filepath or title. It is the frontmatter `id`.

Recommended rules:

- Every `Feature`, `Change`, `System`, `Decision`, `Source`, and `Query` has an `id`.
- `id` is immutable after creation.
- Title exists for human readability, and path is only storage location.
- Aliases are search aids, not identity.

Core principle:

> Human-readable reference uses title/link; machine identity uses `id`.

### 11.2 Rename / Move Policy

- Note rename is allowed.
- File move is also allowed.
- `id` remains unchanged after rename/move.
- On index rebuild, the current `id -> path/title/aliases` mapping is recalculated.
- `verify` must report duplicate `id`, missing `id`, unresolved links, and ambiguous title collisions as errors.

Reasons:

- In Obsidian, filenames and titles can change frequently.
- Using path/title as canonical keys makes search and links unstable.
- Fixing identity on `id` preserves a refactor-friendly knowledge graph.

### 11.3 Role Separation Between Vault and Code

The phrase `single source of truth` does not mean "the vault is more real than the code." It should be interpreted as meaning that the vault is the canonical record of intended behavior and documented current state.

Recommended interpretation:

- The codebase is the executable implementation.
- The vault is the canonical record of intended behavior, design decisions, and change history.
- They are different layers, and `verify` must reveal drift between them.

In short:

> The vault is declared truth; the code is executed reality.

### 11.4 Acceptable Drift by Status

Drift should be treated differently depending on state.

- `proposed`
  - It is normal for the vault to be ahead of the code.
  - Drift is expected.

- `planned`
  - Proposal, design link, task list, validation plan이 확정된 상태다.
  - This is the replacement for an `apply-ready` contract.
  - 이 상태부터 implementation/apply work를 시작할 수 있다.

- `in_progress`
  - Partial drift is allowed.
  - Implementation and documentation are moving together.

- `applied`
  - Related `Feature`, `Decision`, and `System` notes should be materially aligned with the code.
  - If `verify` finds important drift, the change should not remain `applied`.

Core principles:

- Drift during active work is acceptable.
- Drift in completed state is an error.

### 11.5 Handling Code-First Changes

In reality, teams can always change code outside the workflow first. v1 should not prohibit this, but it should not hide it either.

Recommended handling:

- If a code-first change is detected, `verify` records a drift finding.
- The user must choose one of the following:
  - update related `Feature`/`Decision` notes to match the code
  - create a new `Change` and formally absorb that work into history
  - explicitly mark it as experimental and revert it

Non-goals:

- fully reconstructing feature specs from code automatically in v1
- automatically fixing all code-first changes in v1

## 12. Recommended Product Definition

The recommended definition of `open-wiki-spec` is:

> A system that uses an Obsidian vault as the single source of truth for structuring and maintaining the current canonical state, proposed changes, technical systems, decisions, and source materials of a codebase as an agent-driven wiki workflow system

Important implications of this definition:

- It is not just a collection of document templates.
- It is not just an Obsidian plugin.
- It is not a fork with the OpenSpec name changed.
- It is a system for operating a persistent wiki for code management.
- The first version targets a workflow in `Claude Code` that uses a retrieval subagent.

## 13. Recommended Information Structure

### 13.1 The Vault Is the Single Source of Truth

The canonical project knowledge exists in the Obsidian vault.

Here, "canonical" means:

- the current state of features
- the intent and scope of changes
- technical decisions
- related evidence
- investigation results

The codebase remains the executable implementation of the system, while the vault is the structured knowledge layer about that implementation.

### 13.2 Recommended Note Types

The recommended note types are:

- `Feature`
- `Change`
- `System`
- `Decision`
- `Source`
- `Query`

Each type plays the following role:

- `Feature`: the canonical spec for current behavior
- `Change`: a proposed or in-progress change
- `System`: an upper technical boundary/context note
- `Decision`: an important design decision and its consequence
- `Source`: evidence such as PRDs, issues, meeting notes, code-reading notes, and so on
- `Query`: analysis notes and captured investigation outputs (Query notes are included in retrieval scan targets — they can surface relevant past investigations)

Base rules for relationship cardinality:

- One `Feature` can have many `Change` notes.
- One `Change` primarily targets one `Feature` by default.
- A cross-cutting change that touches multiple `Feature` notes is allowed as an exception, but the v1 default is a single-feature change.
- If a cross-cutting change is needed, `Change` may use plural `features:`. Otherwise it uses singular `feature:`.

Serialization rules:

- A single-feature change is serialized as `feature: "<wikilink>"`.
- A multi-feature change is serialized as `features: ["<wikilink>", ...]`.
- Do not put arrays under `feature:`.
- Do not put a single scalar under `features:`.
- Do not use `feature:` and `features:` at the same time.

Core principles:

- The default v1 path should stay simple.
- Multi-feature changes are allowed, but must not be the default.

### 13.3 Recommended Folder Structure

```text
wiki/
  00-meta/
    index.md
    log.md
    schema.md
    conventions.md
  01-sources/
  02-systems/
  03-features/
  04-changes/
  05-decisions/
  06-queries/
  99-archive/
```

Intent:

- `00-meta` contains operational files
- `schema.md` declares the vault-wide schema version and migration notes. Recommended format:

```yaml
# wiki/00-meta/schema.md
---
schema_version: "2026-04-06-v1"
note_types: [feature, change, system, decision, source, query]
---
# Schema

## Current Version
2026-04-06-v1

## Required Frontmatter Fields
- All types: type, id, status, tags
- Feature: systems, sources, decisions, changes
- Change: created_at, feature (or features), depends_on, touches, systems, sources, decisions

## Migration Log
| Date | Version | Change | Migration |
|------|---------|--------|-----------|
| 2026-04-06 | v1 | Initial schema | N/A |
```

- `sources/systems/features/changes/decisions/queries` are human-readable organizational areas
- Real discovery is driven more by links and frontmatter than by folders

## 14. Recommended Canonical Document Model

### 14.1 Feature = Canonical Spec

`Feature`는 현재 feature의 canonical document이며, OpenSpec의 main spec에 해당하는 정본 artifact다. 다만 open-wiki-spec에서는 이것을 자유 서술형 문서로 두지 않고, 사람이 읽기 쉬운 구조 위에 machine-verifiable contract를 겹쳐 놓는다.

Recommended minimum structure:

```md
---
type: feature
id: feature-auth-login
status: active
systems:
  - "[[System: Authentication]]"
sources:
  - "[[Source: Auth PRD]]"
decisions:
  - "[[Decision: Session Strategy]]"
changes:
  - "[[Change: Add Passkey Login]]"
tags:
  - feature
---

# Feature: Auth Login

## Purpose

## Current Behavior

## Constraints

## Known Gaps

## Requirements

### Requirement: Passkey Authentication
The system SHALL allow a registered user to authenticate with a passkey.

#### Scenario: Successful passkey sign-in
- WHEN a registered user selects passkey login
- THEN the system MUST begin WebAuthn authentication and complete sign-in or return a recoverable failure state

## Related Notes
```

`Requirements` 섹션은 선택 사항이 아니라 canonical spec의 minimum contract 일부로 유지되어야 한다. 각 requirement는 최소 다음 규칙을 따른다.

- `### Requirement: <name>`의 `<name>`은 해당 Feature 내에서 unique한 stable key다.
- canonical identity는 `feature_id + "::" + requirement_name` composite key다 (예: `feature-auth-login::Passkey Authentication`).
- normative statement에 `SHALL` 또는 `MUST`가 반드시 포함된다.
- requirement마다 최소 1개의 scenario가 존재한다.
- 각 scenario는 `WHEN`/`THEN` 형태의 검증 가능한 기대 결과를 포함한다.
- requirement name의 rename은 해당 Feature를 수정하는 `Change`의 `Delta Summary`에서 `RENAMED`로 추적해야 한다.

이렇게 해야 `Feature`가 Obsidian 친화적인 문서이면서도 OpenSpec 수준의 기계적 검증 대상이 될 수 있다.

### 14.2 Change = Proposal + Task List + Status

`Change` is the work node that combines OpenSpec's proposal/tasks/status concepts.

Recommended minimum structure:

```md
---
type: change
id: change-add-passkey-login
status: proposed
created_at: "2026-04-06"
feature: "[[Feature: Auth Login]]"
depends_on:
  - "[[Change: Refactor Session Tokens]]"
touches:
  - "[[Feature: Auth Login]]"
  - "[[System: Authentication]]"
systems:
  - "[[System: Authentication]]"
sources:
  - "[[Source: WebAuthn Notes]]"
decisions:
  - "[[Decision: Use WebAuthn]]"
tags:
  - change
---

# Change: Add Passkey Login

## Why

## Delta Summary
- ADDED requirement "Passkey Authentication" to [[Feature: Auth Login]]
- MODIFIED section "Current Behavior" in [[Feature: Auth Login]]: updated to reflect passkey support
- ADDED requirement "Session Token Refresh" to [[Feature: Auth Login]] [base: n/a]
- MODIFIED requirement "Password Login" in [[Feature: Auth Login]]: added recovery scenario [base: sha256:def456...]
- RENAMED requirement "Login Auth" to "Password Login" in [[Feature: Auth Login]] [base: sha256:789abc...]

## Proposed Update

Add passkey login support to the existing auth flow and link the durable technical rationale to a dedicated Decision note.

## Design Approach

Implement WebAuthn registration and authentication flows using the existing session middleware. Store credential IDs in the user profile table. Reuse the current token refresh pipeline for passkey sessions.

For the durable rationale on why WebAuthn was chosen over FIDO U2F, see [[Decision: Use WebAuthn]].

## Impact

## Tasks
- [ ] ...
- [ ] ...

## Validation

## Status Notes
```

`Delta Summary`는 machine-readable change log 역할을 한다. `Feature`를 직접 갱신하는 방식에서는 무엇이 바뀌었는지를 별도 artifact로 남겨야 later verify와 history reconstruction이 가능해진다.

권장 연산 집합은 `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED`다. 정규 문법은 다음과 같다.

- requirement operation: `- (ADDED|MODIFIED|REMOVED) requirement "<name>" (to|in|from) [[<Feature>]]`
- RENAMED: `- RENAMED requirement "<old>" to "<new>" in [[<Feature>]]`
- section operation: `- (ADDED|MODIFIED|REMOVED) section "<section>" in [[<note>]]`
- `MODIFIED`, `REMOVED`, `RENAMED` entry에는 `[base: <content_hash>]`를 붙여 작성 시점의 대상 requirement body hash를 기록한다. `ADDED`는 기존 대상이 없으므로 `[base: n/a]`다.

Atomic apply order는 다음과 같다 (OpenSpec의 `buildUpdatedSpec()`과 동일한 순서):

1. `RENAMED` — 이름을 먼저 변경해야 후속 연산이 새 이름을 참조할 수 있다.
2. `REMOVED`
3. `MODIFIED`
4. `ADDED`

`Proposed Update`는 상세 설계 문서가 아니라 간략한 what/how 설명만 담는다 (1~3 문장).

`Design Approach`는 이번 `Change`에서만 유효한 ephemeral 기술 설계를 담는다. 파일 변화 계획, 데이터 흐름, 아키텍처 접근법 등이 여기에 들어간다. `Change`가 `applied`/archived 되면 이 섹션도 함께 소멸한다. 사소한 변경에서는 생략하거나 `N/A`로 명시할 수 있으며, `Design Approach`가 없다고 해서 `planned` 전이가 차단되지는 않는다 (soft prerequisite). 다만 복잡한 변경에서 `Design Approach`가 빠져 있으면 `verify`가 warning을 보고한다.

`Decision` note는 장수하는 durable rationale을 담는다. `Design Approach`와 `Decision`은 내용이 중복되어서는 안 된다. `Design Approach`에서 durable rationale이 필요하면 `Decision` note를 만들고 `[[링크]]`만 걸어야 한다. `Design Approach`는 "이번에 어떻게 구현할 것인가"를, `Decision`은 "왜 이 기술 선택을 했는가"를 담는다.

다음 기준 중 하나라도 만족하면 `Decision`으로 승격하는 것이 좋다.

- 여러 `Feature` 또는 `System`에 영향을 준다
- 되돌리기 어렵거나 migration cost가 크다
- 팀 컨센서스 또는 ADR 수준의 검토가 필요하다
- change 수명보다 더 오래 남아야 하는 기술적 이유를 담고 있다

`Status Notes`는 operational log용이며 어떤 gate 조건에도 포함되지 않는 완전한 optional 섹션이다.

The default is the singular `feature:` field shown above.

`feature:` 또는 `features:`는 canonical target을 뜻하고, `touches:`는 broader impact surface를 뜻한다. 즉 `touches:`는 similarity scan의 보조 정보가 아니라 sequencing과 parallel conflict detection을 위한 명시적 메타데이터다.

`depends_on:`은 이 `Change`가 다른 `Change`의 완료 또는 특정 상태를 전제로 할 때만 사용한다. 순서 관계가 없는데도 모든 관련 change를 나열하는 용도로 쓰면 안 된다.

Only when a cross-cutting change needs multiple primary `Feature` targets should it use plural `features:` like this:

```md
---
type: change
id: change-unify-auth-and-session-handling
status: proposed
features:
  - "[[Feature: Auth Login]]"
  - "[[Feature: Session Management]]"
---
```

So `feature:` is fixed as a scalar and `features:` is fixed as a list. Parser, indexer, and verifier should all follow the same rule.

### 14.3 Decision, System, and Source Also Have a Minimum Contract

Notes are not fully free-form documents. Each note type has a `minimum section contract`.

특히 `Decision`은 `Change`의 상세 설계를 대신 붙여 넣는 임시 저장소가 아니라, 중요한 기술 선택이 독립적인 수명을 갖도록 만드는 장치여야 한다. 이것이 OpenSpec의 `design.md`가 갖고 있던 역할을 open-wiki-spec에서 더 명시적인 note type으로 승격하는 방식이다.

Advantages of this approach:

- stable agent parsing
- easier Dataview/search/link management
- not so rigid that it becomes unpleasant for humans to read

In other words, this system deliberately chooses the middle ground between a fully free wiki and a rigid spec DSL.

## 15. Recommended Workflow

권장 status lifecycle은 다음과 같다.

`proposed -> planned -> in_progress -> applied`

여기서 `planned`는 OpenSpec의 `apply-ready` 감각을 대체한다.

### Section-Completeness Contract (`proposed` → `planned` 전이 조건)

다음 hard prerequisite가 모두 충족되어야 `planned`로 전이할 수 있다.

1. `Why` 섹션이 비어있지 않다.
2. `Delta Summary`에 최소 1개 entry가 존재한다.
3. `Tasks`에 최소 1개 항목이 존재한다.
4. `Validation` 섹션이 비어있지 않다.

다음은 soft prerequisite다 (없으면 warning이지만 전이를 차단하지는 않는다).

5. `Design Approach`가 존재한다 (또는 명시적 `N/A`). 복잡한 변경에서 빠져 있으면 `verify`가 warning을 보고한다.
6. 중요한 기술 결정이 포함된 경우 최소 1개 `Decision` 링크가 존재한다.

### Next-Action Algorithm

`Change`의 status를 읽고 다음 행동을 결정적으로 계산한다.

```
if status == "proposed":
  missing = checkPlannedPrerequisites(change)  // hard prerequisites only
  if missing.length > 0:
    return { action: "fill_section", target: missing[0] }
  return { action: "transition", to: "planned" }

if status == "planned":
  if depends_on has unresolved targets:
    return { action: "blocked", reason: unresolved_targets }
  return { action: "start_implementation", target: firstUncheckedTask(change) }

if status == "in_progress":
  unchecked = getUncheckedTasks(change)
  if unchecked.length > 0:
    return { action: "continue_task", target: unchecked[0] }
  return { action: "transition", to: "applied" }

if status == "applied":
  return { action: "verify_then_archive" }
```

이것은 OpenSpec의 artifact DAG + `getNextArtifacts()` + `isComplete()`를 section-completeness check로 대체한다. DAG 없이도 결정적이며, `Change` note 하나만 읽으면 다음 행동을 계산할 수 있다.

### propose

- Run similarity scan preflight first.
- The main agent delegates search/scoring work to the retrieval subagent.
- Collect and score related `Feature`, `Change`, `System`, `Decision`, and `Source` candidates.
- Evaluate active `Change` sequencing separately using `depends_on`, `touches`, and requirement-level conflict model.
- Decide one of `existing_change`, `existing_feature`, `new_feature`, or `needs_confirmation`.
- If `existing_change`, continue that change.
- If `existing_feature`, use the existing feature as target and create a new change or update notes as appropriate.
- If `new_feature`, create the new feature first and then connect a new change to it.
- If `needs_confirmation`, stop automatic generation/update and ask the user to choose.
- Run `checkPlannedPrerequisites()`. If all hard prerequisites are met, move the `Change` from `proposed` to `planned`.

### continue

- Read the current `Change` state, linked `Feature`, related `Decision`, and existing `Tasks`.
- Run `nextAction()` to determine what to fill or do next.
- Propose the next work and which notes should be updated.
- Promote major design reasoning from `Change` into `Decision` when it needs an independent lifetime. Do not duplicate content between `Design Approach` and `Decision`.
- Maintain `depends_on` and `touches` so that parallel sequencing remains explicit.
- Once implementation work starts, move the `Change` to `in_progress`.

### apply

- Check `base_fingerprint` of each `Delta Summary` entry against current `Feature` requirement `content_hash`. If any mismatch is found, report `stale_base` and block auto-apply until the user resolves the conflict.
- Apply `Delta Summary` operations in atomic order: `RENAMED` → `REMOVED` → `MODIFIED` → `ADDED`.
- Reflect the implemented change into the canonical `Feature`.
- Update `Requirements` as well as narrative sections when canonical behavior changes.
- Keep `Delta Summary` aligned with the actual canonical edits.
- Update any necessary `Decision` and `System` notes together.
- Change the `Change` status to `applied`.
- Keep the applied note in `04-changes/` first.
- After an explicit retention window or explicit archive command, move it to `99-archive/` while preserving `id`.

### verify

Check for:

- `Completeness`: missing links, missing evidence, stale change state, affected `Feature` not updated, missing `Requirements`, missing `Delta Summary`, orphan notes, `Design Approach` missing on complex changes (warning)
- `Correctness`: invalid status transition, schema mismatch, malformed frontmatter contract, `Delta Summary` not matching canonical edits via operation validation matrix, stale `base_fingerprint`, drift too large for current status
- `Coherence`: conflicting decisions or conflicting descriptions, broken `depends_on`, overlapping `touches` across active changes without explicit sequencing, requirement-level conflict across active changes
- `Vault integrity`: duplicate `id`, unresolved wikilink, ambiguous alias collision, archive placement errors, stale `base_fingerprint` in active changes

In particular, `verify` should explicitly perform `parallel change conflict detection` at both the `touches` level (Feature/System surface) and the `requirement` level (same requirement in same Feature), not only by running a similarity scan.

### query

- Search related notes in the vault graph
- Do not end with an answer only; store the output as a `Query` note when appropriate

That is how investigation output also becomes accumulated knowledge.

### archive

- Move an `applied` `Change` from `04-changes/` to `99-archive/`.
- `id` is preserved, so all wikilink references remain valid after index rebuild.
- Before archiving, `verify` should run to confirm the `Change` is cleanly `applied`.
- Archive is a user-initiated action, not automatic. The retention window in `04-changes/` has no fixed default — the user or team decides when to archive.
- Archived changes remain searchable in the vault but are excluded from active `touches`/`depends_on` sequencing.

## 16. Advantages of This Approach

### 16.1 Human-Friendly

- Easy to read and explore directly in Obsidian
- Works naturally with backlinks, graph view, search, and Dataview
- Feels more like a real wiki than a pile of spec files

### 16.2 Agent-Friendly

- Note types and minimum templates make parsing stable
- The current canonical state, related evidence, and impact scope can be reconstructed quickly
- Context loss is reduced even across new sessions

### 16.3 Lower Maintenance Cost

- The structure resists collapse better than fully free-form documents
- It supports a more practical wiki operation model than an overly rigid OpenSpec-style tree
- It is easier for the agent to handle bookkeeping

### 16.4 It Preserves Both Change Tracking and Knowledge Accumulation

- It preserves OpenSpec's strength in change-management thinking
- It gains the strength of the Karpathy wiki pattern: an accumulating knowledge layer
- It keeps formal artifacts alive in adapted form instead of abandoning them: machine-verifiable requirements, machine-readable delta summaries, and explicit decision notes

## 17. Non-Goals

The initial non-goals of `open-wiki-spec` are:

- full file-format compatibility with OpenSpec
- lossless transformation of every OpenSpec artifact into the same shape
- preserving the existing OpenSpec CLI structure unchanged
- a design that depends on Obsidian plugins
- broad multi-agent-runtime compatibility in the first version
- a completely free-form wiki
- replacing task trackers / Jira
- autonomous knowledge overwrites without sources

This product should not be "a tool that reads any markdown." It should be a `code management wiki with operating conventions`.

## 18. Recommended Implementation Strategy

The recommended implementation strategy is not `fork-based extension`, but `new-repo-based hybrid extraction`.

That means:

- start from a new repository
- design the architecture from scratch in an Obsidian-first way
- only borrow concepts and selectively reuse a small number of general utilities from OpenSpec when useful

Why this is a good strategy:

- It avoids clashing with OpenSpec's filesystem-native assumptions.
- It keeps the product identity clearly separate.
- It avoids unnecessary compatibility burden early.
- It produces a product designed for a new storage model, instead of a product created by forcing a fork into shape.

## 19. Final Conclusion

`open-wiki-spec` is not a rebranding of OpenSpec.

More precisely, it is:

> A new code management wiki system that borrows OpenSpec's change-management concepts, but uses Karpathy's LLM-maintained wiki pattern and treats an Obsidian vault as the single source of truth

The core choices are already defined:

- `Plain Vault Mode`
- `Feature` is the canonical spec with machine-verifiable `Requirements` (composite key identity, `SHALL`/`MUST` + `WHEN`/`THEN` scenarios)
- `Change` carries structured `Delta Summary` (`ADDED`/`MODIFIED`/`REMOVED`/`RENAMED` with `base_fingerprint`), `Design Approach` (ephemeral), `depends_on`, and `touches`
- `Task` lives as a checklist inside `Change`
- major technical design choices are promoted into `Decision` (no content duplication with `Design Approach`)
- stale-change detection via `base_fingerprint` + `content_hash` comparison
- atomic apply order: `RENAMED` → `REMOVED` → `MODIFIED` → `ADDED`
- touches severity model: `parallel_safe` / `needs_review` / `conflict_candidate` / `blocked` + requirement-level `conflict_critical`
- deterministic next-action via section-completeness contract + `nextAction()` algorithm
- deterministic ordering via `depends_on` topological sort + `(created_at, change_id)` tiebreak
- completed `Change` notes remain status-based first and archive later
- each note type has a minimum template contract
- Obsidian is the UI, while the CLI/agent is the workflow engine

이것은 OpenSpec의 무손실 이식이 아니다. 대신 open-wiki-spec은 Obsidian-first 재설계를 택하면서도, 정밀 delta 추적(requirement-level structured delta + stale-base detection)과 정형 artifact workflow(section-completeness contract + deterministic next-action)를 가능한 한 유지하도록 contract를 다시 배치한다.

The biggest advantage of this design can be summarized in one sentence:

> Instead of rereading files and reconstructing context every time, the agent works by reading an already accumulated and connected knowledge graph.

Every design decision in `open-wiki-spec` should be judged by whether it supports that sentence.
