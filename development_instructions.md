# Development Instructions

- You are not allowed to bypass typing issues with unsafe casts or type invalidation patterns.
- Do not use `as unknown as ...`, `as any`, or JSON serialize/parse hacks to silence type errors.
- Find and fix the root cause of typing problems in types, interfaces, or function boundaries.
- If typing cannot be made correct immediately, stop and explain the blocker explicitly.
- When behavior, workflow, or runtime configuration changes, update the relevant docs (including Mermaid workflow charts) in the same change.
- Always run automatic lint error correction first (`yarn lint:fix` or package-local `lint:fix`) before final linting.
- Always run `yarn format` after edits.
- Always run `yarn lint` at the end and fix all reported errors.
