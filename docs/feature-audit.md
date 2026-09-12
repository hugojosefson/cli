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

## Specific repair output

The combined checkout for [#54](https://github.com/hugojosefson/cli/issues/54)
included the GitHub detection and Git-ignore fixes above. Both
`hj repo features` and `deno task hj repo features` reported all 53 expected
states: 26 enabled and 27 disabled. None reported ambiguity or drift. The
installed command confirmed the states before the repair-output change merged.
This inspection left `.gitignore` unchanged.

Matching enabled and intentionally disabled features now show their detection
evidence without generic no-repair messages or empty repair lines. Detailed
repair actions and manual guidance remain for states that need action.
`--repair` alone still leaves disabled features disabled. A positive feature
flag can still enable a disabled feature.

The CLI regression used a temporary repository with custom lines after valid
managed ignore entries. Status reported enabled, and `--repair` reported
`No changes.` The file remained byte-identical. After the test removed the
required coverage entries, status named only these additions:

```text
Add .gitignore line 7: # hj:git-ignore /coverage/
Add .gitignore line 8: /coverage/
```

Inspection did not write those lines. Explicit repair added them after the
existing entries and preserved the custom prefix and suffix. The next inspection
reported enabled without repair.

Other regression cases compared repair descriptions with applied formatting
changes and shared README and lock configuration. Tests covered exact workflow
keys and commands, comment removal, blocked dependencies, and credential
redaction. Status did not prompt, run project tasks, create files, or change
GitHub resources.

The combined `deno task ci` passed 636 tests and seven named steps. Coverage
passed all limits: 90.8% of lines, 91.8% of branches, and 93.5% of functions.

## Omit redundant repair messages

The inspection for [#64](https://github.com/hugojosefson/cli/issues/64) compared
`hj repo features` with `deno task hj repo features`. Both commands reported all
53 expected states: 26 enabled and 27 disabled. None reported ambiguity or
drift. The installed command still printed 53 generic no-repair lines before
this change merged. The updated checkout printed none and retained every
detection observation. Its `deno-lint` output used one line:

```text
deno-lint                      enabled        Deno task lint is configured.
```

The 17 focused tests passed. They covered the absence of empty repair lines,
exact missing `.gitignore` additions, manual blockers, read-only previews, and
unchanged behavior for `--repair` on disabled features.

## Generated README and command guidance

The September 12, 2026 inspection for
[#29](https://github.com/hugojosefson/cli/issues/29) ran both `hj repo features`
and `deno task hj repo features` before and after the changes. Both final
inspections reported 53 features: 26 enabled and 27 intentionally disabled. None
reported ambiguity or drift. The generated README provider is now enabled, and
the static provider is disabled.

`deno task readme-example` generates the included Markdown fragment and colored
image from this repository's local feature detections. `deno task readme` builds
the root README. `deno task readme-check` freshly generates all three artifacts
in memory and compares them with the tracked files. CI runs that check without
credentials or changes to the checkout. Edited or missing artifacts fail with
the refresh commands.

`deno task hj repo features --readme-build --github-default-project --yes`
returned `No changes.` The new implementation kept the API section absent and
did not repeat the Deno installation requirement. A checkout gave the editable
README source and LICENSE mode `0664`. The audit named the affected files.
`chmod 644 LICENSE readme/README.md` restored the expected permissions before
the final inspections.

`stat` confirmed mode `0444` for root `README.md`, and
`git ls-files --error-unmatch README.md` confirmed tracking. The file is not
ignored. A regression test checks that rebuilding after a real Git checkout
restores read-only permissions and keeps the generated file tracked. Git does
not store write permissions, so the build task restores them after checkout.

Command tests cover missing Git and GitHub CLI, installation links, sign-in with
redirected streams, cancellation, and authentication before existing remote
setup. A terminal test with a mock GitHub CLI passed the prompt, login, and
authentication recheck. README tests cover library ownership of API links,
removal of unchanged legacy API blocks, preservation of custom sections, and
feature commit ownership.

The combined `deno task ci` passed 665 tests and seven named steps. Coverage
passed all limits: 90.9% of lines, 91.9% of branches, and 93.7% of functions.

## Current-user file access

The September 12, 2026 inspection ran `hj repo features` and
`deno task hj repo features`. Both commands reported a writable generated README
after checkout. The updated detection accepts the editable source and LICENSE
with mode `0664`. It accepts generated README output whenever the current user
can read the file but cannot write to it.

`deno task readme-example` and `deno task readme` restored the generated output.
The repeated checkout inspection reported every feature as enabled or
intentionally disabled, with no ambiguity or drift. The README source and
LICENSE kept their existing permissions. Inspection did not change files or
remote resources.

Regression tests cover alternate sharing permissions, current-user access,
read-only inspection of files and directories, and permission repair that
preserves unrelated bits. License removal uses the observed README mode in its
change guard. Node 26.2.0 and Bun 1.4.2 passed native access tests, including a
read-only file owned by another user. New implementation and test code use
`node:` imports and add no `Deno.` namespace references.

The final `deno task ci` passed 692 tests and 29 named steps. Coverage passed
all limits. A separate run of `readme build` with only `--allow-read=.` produced
the same README. The installed `hj` still uses the earlier implementation and
reports unnecessary `644` repairs for LICENSE and the editable README source.
Use `deno task hj repo features` to inspect this change before installation.
