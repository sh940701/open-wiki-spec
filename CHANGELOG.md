# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-04-13

### Added
- **Unified CLI JSON envelope** — all commands now wrap `--json` success output in a common envelope:
  ```json
  { "ok": true, "command": "<name>", "envelope_version": "1", "version": "0.3.0", "data": { ... } }
  ```
  Error output keeps the existing `{ "error": true, "code", "message" }` shape (unchanged).
  `ENVELOPE_VERSION` constant is exported from the package for strict consumer pinning.
- `CliJsonEnvelope<T>` type export for TypeScript consumers of `--json` output.
- Feature ↔ Change bidirectional backlink verification (`MISSING_LINK` on mismatch).
- Commit-marker based atomic apply recovery — partial-rename crashes now roll back to a consistent pre-apply state instead of leaving mixed content.
- Early stale-base detection in `ows continue` — warns before apply when another Change modified the Feature.
- Korean intent detection in `propose` (수정/삭제/조사 keywords).
- `semantic_used` field in retrieval results so JSON consumers can detect lexical-only fallback.
- `classification_reason` field explains why `needs_confirmation` was chosen.
- Multi-Feature apply hard-fails on any Feature's semantic failure (was silent partial apply).
- `--force-stale` now records detailed bypass warnings per entry.
- `continue` exits with code 1 on `blocked` action (CI-friendly).
- Secret leak check covers AWS ASIA (temp session keys), GCP service account JSON, and generic hardcoded credentials.
- Embedder singleton-per-model prevents duplicate concurrent model loads.
- `migrate --allow-existing-vault` flag for explicit opt-in merging.
- `ows status` human output surfaces `guidance` + `templateHint` and prints a next-command hint.
- `ows propose` success output shows `Next: ows continue <id>`; `ows apply` shows `Next: ows verify <id>`.
- Envelope-only `envelope_version: "1"` field for future schema drift detection.

### Changed
- Migrated changes (from OpenSpec) with empty `delta_summary` are now reported as `warning` instead of `error` — fresh migrations pass `ows verify` out of the box; authors still must fill canonical delta_summary before `ows apply`.
- Migration post-processes Feature ↔ Change backlinks so the first `ows verify` after `ows migrate` passes cleanly.
- Apply no longer auto-transitions to `applied` when agent markers remain unfilled (safer default; prevents post-hoc `UNFILLED_APPLY_MARKER` after a silent lie).
- Semantic similarity scores clamped to [0, 1] to prevent bad embeddings from dominating rankings.
- Control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F) stripped during normalization to block title/alias spoofing.
- Locale-independent deterministic sort for duplicate tie-break and list output (uses `Intl.Collator('en', { numeric: true })`).
- `init --force` preserves user-authored `wiki/00-meta/conventions.md` even on re-init.

### Fixed
- `ows apply` recovery from crashed runs no longer produces mixed pre-/post-apply state.
- Embedding cache merge-on-save prevents concurrent `propose` runs from dropping each other's entries.
- CLI EXDEV (cross-device rename) fallback to copy+unlink for Docker bind mounts and NFS.
- Log.md mutex reclaims locks held by dead PIDs (not just TTL).
- Apply file-mode preservation on temp writes (read-only vault stays read-only).
- `--force-target` + `--force-classification new_feature` rejected with clear error.
- `--confirm` + missing `--force-classification` on `needs_confirmation` rejected with clear error.

### Compatibility
- **JSON consumers**: must now access payload via `.data.*` instead of `.*` at root. Error responses unchanged.
- **Migration from OpenSpec**: `ows migrate` → `ows verify` produces a passing report out of the box (new behavior).

## [0.2.4]
- Previous release. See git history.
