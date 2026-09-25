/** @module Warnings and manual review instructions for local overwrite. */
export const overwriteWarning =
  "WARNING: --overwrite can replace and remove local files.\nReplacement can permanently remove uncommitted and untracked content. Git cannot put that content back.\nProject tasks can change local files. Custom scripts keep their own behavior and can make Git commits.";
export const overwriteNextSteps =
  "Next steps:\n1. Examine git status --short and git diff. Git diff does not show untracked files.\n2. Examine untracked files and git diff --cached for staged content.\n3. Use git restore --source=HEAD -- <path> for necessary tracked content. This removes uncommitted changes from that path.\n4. Resolve the differences and validate the project.\n5. Examine git log -5 --oneline for commits from project tasks.\n6. Stage the intended files and commit manually.";
