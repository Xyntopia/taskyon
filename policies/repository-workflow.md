# Repository Workflow Policy

Apply this policy to Git operations, branch work, commits, merges, rebases, and repositories nested
inside the workspace.

## Preserve Existing Work

- Assume existing worktree and index changes belong to the user unless their origin is known.
- Do not revert, unstage, overwrite, or reformat unrelated changes.
- Inspect nested repositories and submodules directly before interpreting a parent repository's
  status.
- Avoid destructive Git commands. Use explicit, recoverable, non-interactive operations.
- Ask before resolving an ambiguous merge or conflict side.

## Branch And History Decisions

- Use the exact base, branch, or remote named by the user.
- Verify ancestry and current repository state instead of inferring it from branch names.
- Keep general fixes separate from product-specific or private-service changes.
- Do not move a change across an ownership or release boundary merely because the code applies
  cleanly.
- Preserve authorship and history intent when rebasing, backporting, or splitting changes.

## Commits And Verification

- Keep commits focused on one coherent change.
- Include only intended files; do not treat unrelated worktree cleanup as part of the task.
- Run the focused checks required by the changed boundary before publishing history.
- Report unresolved conflicts, skipped checks, and external blockers explicitly.
- Use current repository documentation and configuration for branch names, commands, and commit
  conventions rather than duplicating those changing facts into this policy.
