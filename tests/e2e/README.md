# E2E Tests

## Architecture

E2E tests in this directory use **direct function imports** rather than spawning the actual CLI binary (`ows`). This is intentional:

- **Speed**: Function-level invocation avoids Node.js process startup overhead per test case.
- **Reliability**: No dependency on the build output (`dist/`) being up to date.
- **Debuggability**: Stack traces point directly to source, breakpoints work naturally.

## What these tests cover

Each test file exercises a full workflow end-to-end through the core modules:

- `workflow-init-propose-continue.test.ts` -- init, propose, continue lifecycle
- `workflow-apply-verify-archive.test.ts` -- apply, verify, archive lifecycle
- `query-sequencing-edge.test.ts` -- query and sequencing edge cases
- `migration-syeong-app.test.ts` -- OpenSpec migration path

## CLI binary smoke testing

For testing the actual CLI binary (argument parsing, exit codes, `--help` output), use `npm pack` followed by a smoke test script:

```bash
npm run build
npm pack
# Install the tarball in a temp directory and run basic commands
```

This is not automated in CI yet -- it should be done manually before publishing.
