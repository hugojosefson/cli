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
states. After regenerating the tag and GitHub Release workflows from the public
implementation commit, every current-checkout feature was enabled or
intentionally disabled, with no drift, ambiguity, or unknown state.

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
separate dispatch run also passed its help and dependency isolation cases. The
pull request records the final full `deno task ci` result and publication
evidence.

The renderer subprocess imported both new dependencies and produced linked
entries without any environment permission. The generated preparation command
adds only `GITHUB_REPOSITORY` to its existing permission list. The dependency
versions are `conventional-commits-parser@7.1.2` and
`conventional-changelog-writer@9.2.1`. Version calculation keeps
`fork-version@5.2.0`.

The earlier tag workflow lacks the new repository permission. Its repair preview
names that exact addition once and preserves the recorded source pin. The tag
and GitHub Release workflows now select public commit
`5d5bdf831c15025774ed5fd7f22ca8778c3ed7b2`, containing the implementation and
the HTML-comment regression fix, candidate-only release validation, and
dependency caching from the integrated main branch. They were regenerated
through the same artifact builder used by feature repair. The public source
passed the source-validation route with narrow release-command permissions. The
separately loaded public renderer imported and rendered without permission
grants.

The production npm build and native test build passed after both frozen npm
manifests were given the same exact parser and writer versions. Built Node and
Bun migration previews matched CHANGELOG.md byte for byte. The Deno import
isolation fixture now copies the root frozen graph and reports unexpected
underlying import errors; a fresh-cache reproduction passed without fetching
additional fixture dependencies. Its runner grants read access only to the two
additional config/lock files needed by that test.

After integrating concurrent release and CI work, 50 focused checks passed for
command dispatch, preparation, orchestration, release features, and repair
output. The pull request records the complete local matrix and final GitHub
check results.
