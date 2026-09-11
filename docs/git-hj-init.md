# Missing behavior from `git-hj-init`

This assessment identifies `git-hj-init` behavior that `hj` does not implement
and [planned.md](planned.md) does not already cover. The first section
recommends additions. The second section explains which remaining differences
are historical baggage rather than useful additions.

The comparison uses source inspection from 2026-09-11. No setup or publication
commands ran for this assessment. Existing feature names identify owners for
missing behavior, not requests to implement those features again.

## Recommend bringing into `hj`

These additions address missing repository files, development tasks, and
generated documentation. Extend an existing feature when that feature already
owns related behavior. Add a separate feature only for an independently
selectable capability.

### New features

The following generated files and tasks are missing from `hj`. `git-hj-init`
supplies each through its unconditional setup bundle. Expose them independently
in `hj` so projects can select what they need.

| Proposed feature | Missing behavior to add                                                                                                                                                       | Reason                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git-ignore`     | Manage `.gitignore` entries for generated project output. Add `/coverage/` when coverage writes there and `/node_modules/` when project configuration creates that directory. | Shared exclusions must match actual project behavior. Preserve unrelated entries and remove only unchanged owned entries.                              |
| `editorconfig`   | Create `.editorconfig` with the content below. Preserve custom sections and values. Require neither Git nor Deno.                                                             | Editors need common whitespace conventions across languages.                                                                                           |
| `deno-coverage`  | Depend on `deno-test`. Add explicit coverage collection and a report task that first collects data.                                                                           | Coverage measures which code tests exercise. Generated projects currently lack these tasks, even though the `hj` repository has custom coverage tasks. |

Use this exact `git-hj-init` content as the `editorconfig` starter:

```ini
# EditorConfig: http://EditorConfig.org

root = true

[*]
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
indent_style = space
indent_size = 2
```

### Missing additions to existing features

These are gaps within existing feature responsibilities. The proposed work is
limited to the additions listed here. The README and migration details follow in
separate subsections.

| Existing owner                             | Missing behavior to add                                                                           | Reason                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno-test`                                | Add `dev`: `deno test --parallel --trace-leaks --watch`.                                          | Repeating tests during editing belongs beside running tests once.                                                                                                               |
| `jsr-package`                              | Accept explicit package identity without requiring a linked GitHub repository.                    | `git-hj-init` can name a package before remote creation. Package setup and GitHub linking are separate operations, and package names can differ from repository names.          |
| Shared Git commit handling                 | Resolve Git identity for fresh setup and create one commit for actual planned files.              | `git-hj-init` leaves an initialized history, while fresh `hj` Git initialization creates no commit. Commit useful project content rather than copying the empty-history marker. |
| README providers and contributing features | Add the missing badges, instructions, and local example specified below, with ownership tracking. | Generated projects need documentation that explains their actual package, commands, and examples.                                                                               |
| README and workflow owners                 | Recognize and migrate `git-hj-init` output as described below.                                    | Existing generated files otherwise block adoption or leave duplicate workflows active.                                                                                          |

[run-features.ts](../src/cli/run-features.ts) currently adds an automatic commit
only when Git exists before the operation. The fresh-setup recommendation
concerns that missing path. Existing automatic commits are outside this
inventory.

### Exact README additions

The missing contributions below belong to their related features. A contribution
is content managed by one feature. Keep the existing project heading,
introduction, and license section.

| Missing contribution                                                                         | Owner                                            | Reason                                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| JSR version badge, API documentation link, and `deno add` command                            | `jsr-package`                                    | Readers need the published version, API reference, and dependency installation command.              |
| CI badge for `hj-ci.yaml`                                                                    | `github-ci`                                      | Readers need the status of the workflow that runs project checks. CI means automated project checks. |
| Deno requirement text                                                                        | Deno features through the active README provider | Readers need an accurate runtime requirement in the generated documentation.                         |
| Command installation using the `./cli` export                                                | `deno-cli` with `jsr-package`                    | Command users need instructions that match the actual export.                                        |
| Local `readme/example-usage.ts`, its README content, local run command, and actual test link | `deno-lib` with the active README provider       | Executable examples and documentation can share source code.                                         |

Use shared contribution handling for `readme-static` and `readme-build`. For
`readme-static`, update root `README.md`. For `readme-build`, update
`readme/README.md` and regenerate root `README.md` with `hj readme build`. Track
ownership of each block to prevent duplicates and preserve custom content.
Remove only unchanged blocks owned by a disabled feature.

The following exact additions assume `jsr-package`, `deno-lib`, `deno-cli`,
`github-ci`, and `readme-build` are selected. Each feature contributes only its
own missing blocks. Insert badges after the existing introduction and sections
before the existing license section.

| Parameter                 | Source                                                    |
| ------------------------- | --------------------------------------------------------- |
| `{project}`               | Resolved project name.                                    |
| `{scope}` and `{package}` | Validated Deno package identity, without the leading `@`. |
| `{owner}` and `{repo}`    | Linked GitHub repository identity.                        |

````markdown
[![JSR Version](https://jsr.io/badges/@{scope}/{package})](https://jsr.io/@{scope}/{package})
[![CI](https://github.com/{owner}/{repo}/actions/workflows/hj-ci.yaml/badge.svg)](https://github.com/{owner}/{repo}/actions/workflows/hj-ci.yaml)

## Requirements

Requires [Deno](https://deno.com/).

## API

See the API documentation on
[jsr.io/@{scope}/{package}](https://jsr.io/@{scope}/{package}).

## Installation

Add the package as a dependency:

```sh
deno add jsr:@{scope}/{package}
```

To install the command:

```sh
deno install --global --name {project} jsr:@{scope}/{package}/cli
```

## Example usage

```typescript
@@include(./example-usage.ts)
```

From a checkout of this repository, run the example:

```sh
deno run readme/example-usage.ts
```

For more examples, see the tests:

[test/lib_test.ts](../test/lib_test.ts)
````

For the generated `deno-lib` starter, use this exact local example:

```typescript
import { placeholder } from "../src/lib/mod.ts";

placeholder();
```

This example demonstrates the starter import, not meaningful library behavior.
Tell users to replace the placeholder before publication. Preserve a custom
example and derive imports from the actual library export.

`readme-build` rewrites the example import to `@{scope}/{package}` when the
library target matches the `.` export. For `readme-static`, insert that package
import and the example body directly instead of an include directive. For
`readme-static`, use `./test/lib_test.ts` as the test link target. The local
example file keeps its relative import so a checkout can run it.

Omit command installation without a `./cli` export. Omit library examples for
command-only packages, and omit GitHub badges without a linked repository.
Include a minimum Deno version only when the project explicitly establishes one.
Derive installation permissions from the generated command's actual needs.

### Migration gaps

Migration for `git-hj-init` output remains missing even where `hj` already
implements the destination capability. Recognize generated content and preserve
later project edits. Recommendations against new defaults do not authorize
removal of existing user-maintained files or public exports.

| Existing owner                     | Missing migration behavior                                                                                                                                                      | Reason                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `readme-build`                     | Recognize `git-hj-init` output in an existing `readme/` directory.                                                                                                              | An unowned directory currently blocks adoption.                                                                            |
| `readme-build`                     | Convert recognized `"@@include(./install.sh)";` and `"@@include(./example-usage.ts)";` lines to standalone `@@include(path)` directives. Replace the recognized generator task. | `hj readme build` does not interpret the quoted directive syntax from `git-hj-init`.                                       |
| README providers and `jsr-package` | Preserve edited examples, installation instructions, and existing `./example-usage` exports. Show generated content replacements in the plan.                                   | New defaults must not silently overwrite project work or remove public entry points.                                       |
| `github-ci`                        | Recognize and replace `deno.yaml` and `bump-deps.yaml` from `git-hj-init`.                                                                                                      | Parallel CI and dependency-update workflows create duplicate work.                                                         |
| Release features                   | Recognize `release.yaml` and related `release:*`, `version`, and `git-is-clean` tasks from `git-hj-init`. Migrate them together.                                                | Two release systems must not publish concurrently. Recognition of an earlier `hj-release.yaml` does not cover these files. |

Add migration cases for edited sources, quoted directives, and workflow
collisions. Compare README output before and after migration so the plan can
show meaningful changes. Keep required check names consistent with branch
protection throughout migration.

The affected `hj` implementation lives in
[readme-build-checks.ts](../src/features/readme-build-checks.ts),
[build-readme.ts](../src/readme/build-readme.ts), and
[github-ci-artifacts.ts](../src/features/github-ci-artifacts.ts).

## Recommend not bringing into `hj`

The following differences are also absent from `hj`, but do not justify new
features or defaults. These decisions concern potential additions, not removal
of behavior that `hj` already implements. Preserve custom project content during
any migration.

### Git habits and setup side effects

`git-hj-init` includes personal Git habits and automatic work during setup.
These behaviors do not establish independent repository capabilities. Keep the
missing additions in the first section focused on the requested project changes.

| Missing `git-hj-init` behavior to leave out                             | Reason                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A positional email override that appends local `user.email`             | Git already provides local, global, and conditional identity configuration. A second identity interface in `hj` creates competing sources. |
| An empty `chore: init repo` commit                                      | An empty history marker adds no project content. The recommended fresh-setup commit contains actual planned files.                         |
| A local `init` branch for rebases before the first push                 | A personal rebase bookmark adds a permanent name that users must understand.                                                               |
| Formatting every new file and accepting `error: No target files found.` | Parsing formatter errors adds no user capability. Generated templates can already have correct formatting.                                 |
| Running `@molt/cli --commit --prefix="chore: "` after each new file     | Adding a README or license must not update unrelated dependencies or create dependency commits.                                            |
| Committing each generated file separately                               | File-generation order does not need to become project history.                                                                             |
| Resetting README-source and license commits as reminders                | Git history is not a reminder interface.                                                                                                   |
| Running `deno task default` automatically after setup                   | Feature setup must not implicitly run arbitrary project tasks.                                                                             |
| Displaying all tracked files and the root README through `bat`          | Full-file display adds output and a tool dependency without improving the feature result.                                                  |

### Additional defaults and README content

These differences add personal preferences, redundant examples, or public API
commitments without enough benefit. Keep only the useful subset of a generated
file or example. The exact `.gitignore` exclusions and README omissions below
explain that boundary.

| Missing behavior to leave out                                                               | Reason                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blanket `/.vscode/`, `/.idea/`, `/*.log`, and `.*.swp` exclusions                           | These patterns can hide intentionally shared files. Personal editor exclusions belong in personal Git configuration unless a project selects shared exclusions. |
| `lock: false`                                                                               | Disabling dependency locking is not a general setup requirement. Preserve project configuration and Deno defaults.                                              |
| Two placeholder assertions and an `@std/assert` dependency solely to test an empty function | Additional assertions about an empty function do not demonstrate useful project behavior.                                                                       |
| Mandatory coverage in every ordinary test run                                               | Coverage is useful as an explicit `deno-coverage` operation.                                                                                                    |
| A bare `deno coverage` task that assumes earlier data collection                            | A useful coverage task must establish its own input data.                                                                                                       |
| A JSR score badge by default                                                                | A registry score does not explain installation, behavior, or compatibility.                                                                                     |
| `readme/install.sh` containing only `deno add`                                              | One Markdown command does not need an executable helper file.                                                                                                   |
| Source archive installation through `/tarball/main` and `tar -xzv --strip-components=1`     | Downloading source neither installs a command nor adds a dependency.                                                                                            |
| A default `./example-usage` export and a registry command to run it                         | A documentation example does not need a permanent public package entry point. Use the local example command in the proposed README.                             |
| `console.dir({ result })` for the placeholder example                                       | Printing an undefined placeholder result demonstrates no useful library behavior.                                                                               |
| A copied `readme/generate-readme.ts` and its `@std/path` dependency in every project        | Adding another generator implementation creates maintenance work without a new capability.                                                                      |

### Workflow and naming differences

Exact timing and implementation choices from `git-hj-init` are not compatibility
requirements. The same applies to personal naming conventions and unused
helpers. These differences do not require additional feature switches.

| Missing behavior to leave out                                                                         | Reason                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate default CI runs on PRs and non-`main` pushes                                                | PR checks already cover changes before merge. A separate trigger requires a concrete need to check branches before a PR exists. |
| Reproducing `hasundue/molt-action` and the `0 0 * * *` schedule exactly                               | Midnight and Molt are historical choices, not missing update capabilities.                                                      |
| A release workflow that directly pushes `main` and publishes packages                                 | A second publication path can compete with the coordinated release flow.                                                        |
| Project-local `git-is-clean`, `version`, `release`, and `release:*` aliases copied from `git-hj-init` | These tasks duplicate release responsibilities and can leave a second publication path active.                                  |
| Fetching latest Deno, GitHub Action major tags, or npm `fork-version` during every setup              | Moving defaults undermine repeatable generation.                                                                                |
| Removing a leading `deno` from package names or silently replacing characters with hyphens            | Personal naming conventions must not silently rename a package.                                                                 |
| Inferring JSR ownership from `id -un`                                                                 | A local username does not establish ownership of a JSR scope.                                                                   |
| `get_latest_jsr_version` and `get_latest_deno_land_x_version`                                         | `git-hj-init` does not call either helper. Unused code establishes no user requirement.                                         |
