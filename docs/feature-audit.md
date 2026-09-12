# Repository feature audit

This record covers the repository inspection for
[#56](https://github.com/hugojosefson/cli/issues/56). The
[development guide](development.md#self-check-and-readme-choice) lists the
expected state and reason for every feature.

## Baseline and local repair

The installed `hj repo features` and `deno task hj repo features` both inspected
all 53 features. Both commands reported `git-ignore` as drifted. GitHub reads
also failed during the baseline inspection. The remote results did not prove
that the corresponding features were disabled.

The ignore entries matched the requested patterns, but custom npm exclusions
followed the managed entries. Detection incorrectly required the managed entries
at the end of `.gitignore`. An initial repair only moved those entries.

The corrected feature accepts valid owned entries at their existing positions.
It preserves custom lines after those entries and does not require repair. This
repository retains its original `.gitignore` layout. This command makes sure
that the unchanged layout needs no repair:

```bash
deno task hj repo features --git-ignore --repair --yes
```

The command reports `No changes.` and creates no commit. The custom `.coverage/`
and `/.hj/npm/` exclusions, their comment, and the blank line remain unchanged.
The managed `.*.swp` and `/coverage/` patterns also remain unchanged. The task
argument `--coverage` selects the managed `/coverage/` pattern. This
repository's custom runner writes `.coverage/`, which its custom exclusion
already covers.

Missing or edited required patterns still cause drift. Repair adds the missing
patterns and preserves existing valid entries and custom content. Tests cover
custom suffix lines, both line endings, no final newline, missing patterns, and
edited patterns. A second repair needs no changes.

The next `deno task hj repo features` inspection found no local ambiguity or
drift. All 35 local features matched their expected state: 15 enabled and 20
intentionally disabled. These counts include the four release workflow features.
The other 18 features require GitHub reads.

## Local use

`git check-ignore -v .coverage/example.json .hj/npm/package.json .example.swp
coverage/example.json`
found the expected rule for each path. The managed JSR Version, JSR Score, and
CI badges remained in `README.md`. The static README, MIT license, CLI exports,
EditorConfig defaults, and custom Deno tasks matched their expected states.

`deno task npm-build` built `.hj/npm` without publication.
`node .hj/npm/bin/hj.js --help` ran the generated launcher successfully. npm
publication remained intentionally disabled.

The documented task-conflict example passed one test and four named steps:

```bash
deno task test src/features/deno-task-features_real_test.ts --filter "classifies task conflicts"
```

## Final inspection

The final `deno task hj repo features` inspection included the GitHub detection
fix from [#55](https://github.com/hugojosefson/cli/issues/55). All 53 features
matched the expected states in the development guide: 26 enabled and 27
disabled. None reported ambiguity or drift. Repeating the explicit ignore repair
reported `No changes.` with the original `.gitignore` layout.

The 11 focused ignore tests passed. The full `deno task ci` passed 625 tests and
seven named steps. Coverage passed all limits: 90.7% of lines, 91.7% of
branches, and 93.4% of functions.
