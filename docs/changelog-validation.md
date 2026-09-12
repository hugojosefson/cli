# Changelog validation

Issue [#36](https://github.com/hugojosefson/cli/issues/36) adds the independent
`changelog` feature, grouped release entries, and optional history migration.
This record covers the repository checks on 2026-09-12. The release guide
describes [the preserve and migrate choices](releases.md#changelog-choices).

## Repository use

The installed `hj repo features` and checkout `deno task hj repo features`
commands ran before and after the change. Every feature row was inspected. The
fresh worktree initially reported README mode drift and dependent license drift.
The documented `deno task readme` command restored the generated README
permissions. The later inspection matched the intended enabled and disabled
states, apart from the tag workflow change described below.

The new `changelog` row reports enabled grouped sections. Flat and mixed
fixtures remain enabled and show one optional migration preview command. Custom
and fenced example fixtures remain enabled without that hint. Missing files
report the exact starter that enabling creates. Non-regular paths report the
required manual action. Existing history cannot be deleted through feature
disablement.

`deno task hj changelog migrate` first printed the proposed document.
`deno task hj changelog migrate --write` then converted all 22 release sections.
A second preview matched the written file byte for byte. The
`Initial capabilities` narrative and table also matched their previous bytes.
Each migrated section matched its original tagged Git range before replacement.
No tags or published release data changed.

## Automated checks

The focused Deno run passed 54 test bodies in eight files. It covered feature
lifecycle, stale plans, migration, renderer output, release recovery, GitHub
release extraction, dependency permissions, and repair descriptions. The
separate dispatch run also passed its help and dependency isolation cases. Full
`deno task ci` remains the final gate before implementation approval.

The renderer subprocess imported both new dependencies and produced linked
entries without any environment permission. The generated preparation command
adds only `GITHUB_REPOSITORY` to its existing permission list. The dependency
versions are `conventional-commits-parser@7.1.2` and
`conventional-changelog-writer@9.2.1`. Version calculation keeps
`fork-version@5.2.0`.

The earlier tag workflow lacks the new repository permission. Its repair preview
names that exact addition once and preserves the recorded source pin. The
workflow must select a public implementation commit before this repository uses
the new renderer for future releases.
