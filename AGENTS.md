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

Use Conventional Commit subjects, such as
`feat(package): resolve package identity`.

Run `deno task ci` before reporting implementation as complete.
