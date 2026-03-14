# `@taskyon/taskyon-headless`

Small Node-first headless runner for package-local Taskyon diagnostics.

It is intentionally narrow in v1:

- discovers tests from `../taskyon/src/tests/**/*.ts`
- reuses the shared diagnostics runner
- prints progress to stdout
- emits a machine-friendly JSON summary at the end
- exits non-zero on failures

## Usage

From this directory:

```bash
yarn test-list
yarn diagnostics
yarn diagnostics --filter humanize
yarn diagnostics --details
yarn diagnostics --experimental
yarn diagnostics --online --tyauth "$TYAUTH"
yarn discovery-fixture:run
```

## Notes

- Network/auth-heavy tests are skipped by default unless `--online` is provided.
- Tests that require a Taskyon auth token are skipped unless `--tyauth` or `TYAUTH` is set.
- Experimental tests are excluded by default.
- `yarn discovery-fixture:run` starts two long-running headless nodes on the shared browser/headless discovery fixture so browser clients can join manually via `/p2p`.
