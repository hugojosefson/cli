# Repository issue work

Read [docs/development.md](docs/development.md) before changing the code. Use
the
[cli Project Board](https://github.com/users/hugojosefson/projects/10/views/2)
to select work.

When implementing Project issues, follow these rules:

1. Start Todo issues in their Board order.
2. Use one agent per issue.
3. Include the issue number and title in each agent name, such as
   `issue_23_resolve_package_identity`.
4. Give each agent its own worktree, a separate Git checkout.
5. Run independent issues in parallel when their dependencies permit it.
6. Before implementation starts, move the issue to `In Progress` in the Project.
7. Make sure that the Project saved each status change.
8. Keep the issue `In Progress` while implementation, tests, or review remain.
9. In each pull request description, include `Closes #N` for every issue that
   the pull request fully fixes.
10. Make sure that GitHub recognizes those issue links before reporting the pull
    request as ready.
11. Leave completed issues for GitHub to close when the pull request merges into
    `main`.
12. Make sure that the Project moves closed issues to `Done`.
13. Enable auto-merge with the rebase method for completed pull requests.
14. Use each implemented feature on this repository where relevant and
    non-destructive. Apply useful examples, such as README badges, and record
    the checks. This includes previously completed and future issue work.
15. Run `hj repo features` on this repository and inspect every feature's
    output. Use `deno task hj repo features` to assess changes from the current
    checkout.
16. Make sure that every feature correctly detects this repository without
    ambiguity or drift. Disabled features are valid when they match the project.
17. If a feature reports ambiguity or drift, improve detection, add or improve
    repair, or change this repository's contents as appropriate. Combine these
    approaches when needed. Preserve intentional custom behavior.
18. Make sure that `hj repo features` states each feature's specific repair
    actions. Name affected files, configuration values, or remote resources. If
    repair is unnecessary or unsupported, state that and explain any required
    manual action. Do not present a generic repair hint as a repair description.
19. After changes, repeat the feature inspection and record the results. Apply
    these requirements to all existing and future features.
20. Use `github-default-project` as the model for drifted repair details. Follow
    the item-level standard in
    [docs/development.md](docs/development.md#self-check-and-readme-choice).
    Name each required addition, removal, replacement, value, or order. Generic
    hints, file rewrite notices, and line counts alone do not suffice. Derive
    details from the inspected differences or repair plans. Keep inspection
    read-only.
21. Accept custom additions when all required entries remain correct. For
    example, extra `.gitignore` lines after the managed entries must leave
    `git-ignore` enabled without repair. If required exclusions are missing,
    name the exact lines that repair will add.

Use Conventional Commit subjects, such as
`feat(package): resolve package identity`.

Run `deno task ci` before reporting implementation as complete.
