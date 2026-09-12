# Development

This guide describes work on `hj` itself. Linux is the supported test platform.
The [feature guide](repository-features.md) describes files and tasks that `hj`
adds to other repositories. Use the [Deno](https://deno.com/) version in
[toolchain.json](../toolchain.json). The lockfile records dependency versions.
Test and type-check tasks use `--frozen` to reject unexpected dependency
changes.

## Local commands

Tasks provide the supported development interface:

| Command                                                        | Purpose                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| `deno task hj --help`                                          | Show the local CLI commands.                                  |
| `deno task default`                                            | Format files, then run all checks with coverage.              |
| `deno task fmt`                                                | Format source, tooling, workflows, and documentation.         |
| `deno task all`                                                | Run all checks with coverage.                                 |
| `deno task typecheck`                                          | Type-check source and scripts with frozen dependencies.       |
| `deno task publish-check`                                      | Validate the package without uploading it.                    |
| `deno task check`                                              | Run all checks and enforce coverage limits.                   |
| `deno task ci`                                                 | Run the checks and enforce coverage limits.                   |
| `deno task test src/release/publish-tag-orchestration_test.ts` | Run one test file.                                            |
| `deno task test --filter "recovery"`                           | Run tests with matching names.                                |
| `deno task coverage`                                           | Run the suite and print coverage.                             |
| `deno task coverage-html`                                      | Build `.coverage/html/index.html` from the last coverage run. |

Tests use native `node:test` registrations and portable `@std/assert`
assertions. The shared suite runs in Deno 2.9.6, Node 24.21.0, Node 26.2.0, and
Bun 1.4.2. Every runtime uses the same discovered source and script test files.
The runner starts each file in an isolated process or Deno worker. Node runs one
file at a time, and Bun gets a separate process for each file. Bun and Node
allow 120 seconds per test.

`deno task test` runs the Deno suite. After `deno task test-build`, use
`deno task test --runtime node` or `deno task test --runtime bun` to run the
complete suite in that runtime. Add `--executable /absolute/path` to select a
runtime binary. File paths and `--filter` select tests for development. Filtered
runs cannot satisfy the full matrix gate.

`deno task test-matrix` builds the tests and runs all four runtimes.
`deno task ci` collects Deno coverage once, then runs the three native suites.
The existing required CI check includes this matrix, so a native test failure
blocks an ordinary pull request merge. The runners record executed test and
subtest names in `.hj/test-results`. The matrix requires identical file and test
inventories, with every body complete and successful. Missing registrations,
missing executions, skipped bodies, and failures fail the gate. Printed runner
totals can differ because the runtimes count subtests differently.

Native test builds require Node and npm on the development or CI host. The build
uses the separately pinned dnt emitter with no Deno global or test shims.
Test-only assertions and WebSocket dependencies use a separate frozen npm lock.
The matrix installs exact Linux x64 glibc runtime binaries under
`.hj/test-tools`. Those binaries use a separate integrity lock and require no
installation scripts. The npm CLI package does not include these test
dependencies or runtimes.

Tests use temporary repositories under `/tmp/opencode` and remove their own
fixtures. CLI subprocess fixtures use the selected host runtime. Generated Deno
projects, tasks, servers, installations, and sandbox checks use real Deno from
every host. The Deno runner grants subprocess access to Git, Deno, and the
shell. Server fixtures use HTTP and WebSocket connections on `127.0.0.1`. Tests
do not need GitHub credentials. The runners remove dynamic-loader environment
overrides before starting restricted Deno processes.

Keep cleanup in an awaited test body with `try/finally`. Do not put
failure-sensitive cleanup in `after` or `afterEach` hooks. Deno 2.9.6 can return
success when those `node:test` hooks fail. The runner contract tests exercise
failing bodies, nested tests, awaited cleanup, and child processes, plus passing
controls.

The Deno `node:test` adapter disables resource and operation sanitizers. The
previous default suite did not enable those sanitizers either. Separate
subprocess fixtures explicitly enable native Deno sanitizers and test a leaked
file against a correctly closed file. They also compare a pending timer with a
correctly cleared timer. Real permission fixtures also test denied and allowed
writes. These checks retain Deno diagnostics without claiming per-test leak
detection for the shared suite.

Run one coverage collection at a time because each collection clears
`.coverage`. Coverage limits remain in [deno.json](../deno.json). The report
excludes test files and shared test fixtures. Deno reports loaded modules, so
the total does not prove that every executable path has a test. The executable
also has a test for help without application permissions.

## Install from a checkout

Run `deno task install-local` to install a development command. Add the printed
binary directory to `PATH`. This installation loads source from the checkout, so
keep it at the same path. After moving it, run
`deno task install-local --force`.

| Action                          | Command                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| Install in a separate directory | `deno task install-local --root /absolute/path/to/tools`    |
| Remove that installation        | `deno uninstall --global --root /absolute/path/to/tools hj` |

## Run against another repository

The runner resolves the CLI source from its own location and keeps the caller's
working directory. Use an absolute path to this checkout's runner from a
temporary target repository. Replace the example path with your checkout path:

```bash
mkdir -p /tmp/hj-example
cd /tmp/hj-example
deno run --allow-env --allow-run=deno --allow-read \
  /absolute/path/to/cli/scripts/run-cli.ts repo features
```

To change features, append feature flags from the
[feature guide](repository-features.md). The runner grants the permissions
needed by the CLI. Each command still applies its own checks and confirmation
rules.

## Interactive prompts

All application prompts use the pinned `@inquirer/core` dependency. The terminal
adapter loads the library only for TTY input. Help, repository inspection, and
noninteractive text fallbacks do not read prompt-specific environment variables.

Feature selection supports literal, case-insensitive filtering, arrow
navigation, space to toggle, and Enter to confirm. Selections survive filter
changes and keep selection order. Ctrl+C, Escape, and EOF cancel without
applying any actions or configured defaults. Text prompts require an explicit
answer and keep the existing visibility, scope, and attribution validation in
their callers.

Run `deno task test src/cli/terminal-prompt_test.ts` for stream-based keyboard,
cancellation, and cleanup checks. Before changing the prompt dependency, repeat
those cases in a pseudo-terminal on the supported Deno, Node, and Bun versions.
Check nonmatching filters, punctuation, repeated toggles, text backspace,
Ctrl+C, Ctrl+D, terminal raw-mode restoration, and the command's exit status.
The test runner grants `TERM` and `CLI_WIDTH` for the library's terminal
rendering.

## Package checks

`deno task publish-check` runs `deno publish --dry-run` with full type checks
and the frozen lockfile. It never uploads the package. CI includes this check.
The package exports the CLI executable through both `.` and `./cli`. It has no
supported library API. Its file list includes runtime source, the toolchain
version, license, and docs. Tests and test fixtures stay outside the package.

`deno task install-local` installs a command that loads this checkout. Its test
uses a temporary installation and a caller directory with spaces. It runs help
and applies a formatting feature to confirm the working directory behavior.

## CI and toolchain changes

[hj-ci.yaml](../.github/workflows/hj-ci.yaml) runs `deno task all` for pull
requests. That task runs `ci`, including coverage limits. A separate job checks
release commits. The workflow has read-only repository access and does not
publish anything. Actions use exact commit references.

The same toolchain file supplies the fallback Deno version for newly generated
CI and release workflows. [Global configuration](configuration.md) and
`--deno-version` can select another version. Generated workflows and README
build tasks use the exact `hj` package reference from `name` and `version` in
`deno.json`, so a version change also updates new workflow output. The legacy
release template stays unchanged because migration recognizes its exact bytes.
To update Deno, edit the toolchain file, install that version, and run
`deno task ci`. Existing exact workflows keep their recorded Deno version. To
change that version, select the workflow feature with `--deno-version` and
`--repair`.

To run this repository's workflow locally with Docker and `act`, use:

```bash
act pull_request -W .github/workflows/hj-ci.yaml -j check \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

The host checks need no container. `act` tests workflow execution, but it does
not prove live GitHub ruleset, event, or OIDC behavior. The
[live validation record](live-validation.md) describes the opt-in scratchpad
fixtures, completed checks, and remaining checks.

For native CLI project tasks, see
[local Deno selection and caching](local-deno-runtime.md). The workflow version
setting remains separate from local runtime selection.

## Code structure

The source follows the flow from a request to a guarded change:

| Directory or module | Responsibility                                                            |
| ------------------- | ------------------------------------------------------------------------- |
| `src/api/`          | Type declarations for features, repository readers, and structured plans. |
| `src/cli/`          | Command parsing, help, service construction, and terminal output.         |
| `src/features/`     | Feature detection, dependency selection, and change planning.             |
| `src/artifacts/`    | Inspection and planning for generated files.                              |
| `src/operations/`   | Preflight checks and local or remote plan application.                    |
| `src/repository/`   | Filesystem, Git, and GitHub adapters.                                     |
| `src/readme/`       | README includes and document assembly.                                    |
| `src/release/`      | Release preparation, application, recovery, and publishers.               |

| Module                         | Responsibility                                |
| ------------------------------ | --------------------------------------------- |
| `validate-feature-registry.ts` | Check feature declarations.                   |
| `resolve-feature-changes.ts`   | Resolve a request without external effects.   |
| `resolve-registry-changes.ts`  | Select dependencies and capability providers. |
| `order-feature-changes.ts`     | Order operations.                             |

The resolver does not write files, keep feature history, or remove unused
dependencies.

GitHub transport, response parsing, and canonical ruleset comparison have
separate modules. A canonical representation puts equivalent data in the same
order. Read failures keep the result unavailable and preserve safe diagnostic
metadata. Mutation failures report HTTP status and process exit codes when
available. They never include raw arguments or stderr that can contain
credentials.

Release modules separate pure decisions from external operations.
`apply-types.ts` owns shared contracts and errors. `apply-checks.ts` compares
synthetic checks, which are check runs that `hj` creates. `apply-observation.ts`
handles bounded polling and uncertain requests. `apply-cleanup.ts` owns cleanup
after failure or collision. The [release guide](releases.md#design-constraints)
owns the release invariants.

## Self-check and README choice

Every existing and future feature must correctly detect this repository without
ambiguity or drift. Ambiguity means that detection cannot determine the intended
state. Drift means that detected configuration differs from the supported state.
An intentionally disabled feature meets this requirement when detection
correctly identifies it.

Run `hj repo features` and inspect every feature's output before and after
feature changes. Use `deno task hj repo features` to run the current checkout's
implementation. If detection reports ambiguity or drift, improve detection, add
or improve repair, or change this repository's contents as appropriate. Combine
these approaches when needed. Preserve intentional custom behavior instead of
hiding a real mismatch. Record the commands and results in the pull request or
the relevant validation document.

When action is needed, `hj repo features` must state the specific repair actions
or required manual action. Name the affected files, configuration values, or
remote resources and the changes that repair will make. If repair needs to
replace or remove custom content, describe that effect. If repair is
unsupported, state that and explain the required manual action. A generic
instruction to run `--repair` does not meet this requirement. Make sure that
repair descriptions match the actual repair plan.

For matching enabled and intentionally disabled features, show detection
evidence without generic no-repair messages or empty repair lines. Keep
actionable details for drifted, ambiguous, and unknown states. Disabled features
remain disabled with `--repair` alone.

Use `github-default-project` as the model for drifted repair details. Describe
only changes that the current repository needs. For each change, name the target
and the exact addition, removal, replacement, value, or order. Include relevant
file paths, configuration keys and values, resource names, or issue numbers.
Omit unchanged items unless they explain preservation of custom content. Show
one `--repair` hint per repairable feature and list each required change once.
Omit repeated repair headings, generic plan summaries, and possible setup
operations that the inspected state does not need. Keep substantive warnings,
actual effects, and required manual actions. Add a feature selector to the hint
only when explicit selection is needed for missing dependencies.

For example, report `Add label "area:docs" to issue #36.` Report an option-order
change as `Place Backlog before Todo in project Status options.` For
`.gitignore`, name the exact missing exclusion lines that repair will add.
Generic repair hints, file rewrite notices, and line counts alone do not meet
this standard. Derive details from the same inspected differences or plans that
repair uses. Inspection must remain read-only.

Accept custom additions when all required entries remain correct. Extra
`.gitignore` lines after the managed entries must leave the feature enabled
without repair. Do not require a managed block to appear last. If a required
exclusion is missing or incorrect, describe the exact added lines. Preserve
custom exclusions during repair.

The [default project feature](../src/features/github-default-project-feature.ts)
displays details from the
[project reader](../src/repository/github-default-project.ts) and
[Area comparison](../src/repository/github-project-area.ts). These details name
missing fields, views, labels, and Area values for the affected issues.

Run `hj repo features` to inspect this checkout. Every registered feature is
assessed below. Disabled features are intentional when they provide an
alternative or a service that this CLI does not use. Remote states require
GitHub access, so an unauthenticated visitor can receive different results. The
[repository feature audit](feature-audit.md) records the repeated inspection,
ignore detection fix, and local examples.

| Feature                         | Expected state | Why this matches the project                                                                              |
| ------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `deno-cli`                      | Enabled        | The package exports an executable CLI, including `./cli`.                                                 |
| `deno-config-version`           | Enabled        | The package declares an exact release version.                                                            |
| `deno-fmt`                      | Enabled        | Source formatting and its check are configured.                                                           |
| `deno-lib`                      | Disabled       | The default export runs the CLI. There is no supported library API.                                       |
| `deno-lint`                     | Enabled        | Source and scripts receive lint checks.                                                                   |
| `deno-server`                   | Disabled       | This tool generates servers for other projects but does not serve requests itself.                        |
| `deno-test`                     | Enabled        | The test runner and coverage checks exercise the implementation.                                          |
| `deno-typecheck`                | Enabled        | Source and scripts receive type checks.                                                                   |
| `editorconfig`                  | Enabled        | Editors use the managed defaults in `.editorconfig`.                                                      |
| `git-ignore`                    | Enabled        | Managed editor and coverage exclusions supplement the existing custom exclusions.                         |
| `git`                           | Enabled        | The project has a Git history.                                                                            |
| `github-auto-merge`             | Enabled        | Passing checks allow the release bot to merge its release PR.                                             |
| `github-ci`                     | Enabled        | Managed CI runs project checks and supplies dependency updates.                                           |
| `github-delete-branch-on-merge` | Enabled        | Merged branches are removed automatically.                                                                |
| `github-discussions`            | Disabled       | Issues provide the public feedback channel. A separate forum is not configured.                           |
| `github-issues`                 | Enabled        | Visitors can report bugs and request changes.                                                             |
| `github-main-protection`        | Enabled        | Required checks and linear history protect main.                                                          |
| `github-main-review`            | Disabled       | Required human reviews would interrupt the automatic release flow.                                        |
| `github-merge-commit`           | Disabled       | The project requires linear history without merge commits.                                                |
| `github-private`                | Disabled       | The source is public. Disabled private visibility is intentional.                                         |
| `github-default-project`        | Enabled        | The linked `cli` project contains all repository issues.                                                  |
| `github-projects`               | Enabled        | The Projects setting is enabled. The default-project feature manages the linked project.                  |
| `github-protected-tags`         | Enabled        | Managed tag rules prevent release changes. The CLI enforces exact SemVer.                                 |
| `github-rebase-merge`           | Enabled        | Rebase merging preserves individual commits and linear history.                                           |
| `github-release-publish-github` | Enabled        | The generated workflow publishes GitHub Releases.                                                         |
| `github-release-publish-npm`    | Disabled       | The npm build example runs locally. Public npm publication for this CLI is not configured.                |
| `github-release-publish-jsr`    | Enabled        | The generated workflow publishes packages to JSR.                                                         |
| `github-release-publish-tag`    | Enabled        | The generated workflow prepares release PRs and protected tags.                                           |
| `github-repo`                   | Enabled        | The authenticated CLI can read the linked GitHub repository.                                              |
| `github-squash-merge`           | Disabled       | The project preserves individual commits through rebase merging.                                          |
| `github-update-branch`          | Enabled        | GitHub permits updating a PR branch before merge.                                                         |
| `github-web-commit-signoff`     | Disabled       | The project does not require signoff through the GitHub web editor.                                       |
| `github-wiki`                   | Disabled       | Documentation lives with the source in README and docs.                                                   |
| `jsr-package`                   | Enabled        | Local package metadata and the publish check are configured. This state alone does not prove publication. |
| `license-agpl-3.0-only`         | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-apache-2.0`            | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-bsd-2-clause`          | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-bsd-3-clause`          | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-cc-by-4.0`             | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-cc-by-nc-4.0`          | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-cc-by-nc-nd-4.0`       | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-cc-by-nc-sa-4.0`       | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-cc-by-nd-4.0`          | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-cc-by-sa-4.0`          | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-cc0-1.0`               | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-gpl-2.0-only`          | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-gpl-3.0-only`          | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-isc`                   | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-mit`                   | Enabled        | LICENSE and its README link select MIT.                                                                   |
| `license-mpl-2.0`               | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `license-unlicense`             | Disabled       | MIT is selected. This alternate license provider is intentionally inactive.                               |
| `readme-build`                  | Enabled        | The README includes a generated example from this repository's feature output.                            |
| `readme-static`                 | Disabled       | The root README is generated from editable source and an example fragment.                                |

The README build, CI, tag, GitHub Release, and JSR workflow features can pin an
earlier exact CLI version without being drifted. Detection still compares the
complete task or workflow with its managed template. Changing permissions,
commands, actions, or other content requires repair. To select the current CLI
version for workflows, use the
[workflow source option](releases.md#bootstrap-before-the-first-registry-version).

`check` and `all` depend on `ci`, which runs non-mutating checks and enforces
coverage limits. CI collects tests once through the coverage task. Detection
accepts the project's custom file selections and runner scripts. A configured
task is not proof that its checks pass. The CI result supplies that proof.

Edit [readme/README.md](../readme/README.md), then run `deno task readme`. The
build imports a generated Markdown fragment that links to a colored SVG example.
The example uses this checkout's local feature detectors and terminal formatter.
It shows four representative rows and needs no GitHub access.

Keep the generated root `README.md` tracked in Git. The build sets its file
permissions to `0444` (read-only) and leaves it tracked. Git records the
executable flag but does not record write permissions. After a checkout, run
`deno task readme` to restore read-only permissions.

After changing feature detection or output, run:

```bash
deno task readme-example
deno task readme
```

CI runs `readme-check` through `ci`. This step regenerates the SVG, Markdown
fragment, and complete README in memory, then compares them with the committed
files. It fails with the refresh command when any output differs or is missing.
This also runs in release validation through `all`. It requires no network,
credentials, external commands, or writes. Formatting covers the editable source
and excludes generated output.

The repository uses managed JSR and CI badges. Its custom installation and usage
sections remain intact. The package configuration sets `hj.commandName` to `hj`
because the package name ends in `cli`.

Feature updates run `default`, which builds the README and runs `check`,
including `deno task ci`. Successful updates record separate commits for their
changed features. The existing lockfile stays outside automatic replacement. The
README now uses the existing `readme-build` feature because its generated
example removes manual output maintenance.

The repository already uses `@std/assert` and named test steps. For example,
`src/features/deno-task-features_real_test.ts` groups task-conflict cases with
`await t.step(...)` and asserts each result. Run that example with
`deno task test src/features/deno-task-features_real_test.ts --filter "classifies task conflicts"`.
This self-check passed with one test and four named steps. The starter test
checks also run the generated library test and verify its two named steps. This
CLI keeps its existing tests and public exports.

## First public release

The first public release is `0.2.0`. The [release record](first-release.md)
links the source PR, release PR, package, and live checks. The README installs
from JSR. GitHub CI enforces coverage and a package dry run on Linux.

Merges to `main` start the generated release pipeline. GitHub and JSR
publication use protected tags and rebase merges. The
[release guide](releases.md) owns configuration and retry instructions. The
[live validation record](live-validation.md) records tested behavior and limits.

## Git history

Keep history linear. Rebase a working branch onto `main`, run the relevant
checks, and advance `main` with `git merge --ff-only`. Move tested improvements
onto `main` as soon as they are ready. Do not create merge commits or publish
this repository without authorization.

## Add a feature

A capability is a function that one or more features provide. An artifact is a
file or resource that a feature manages. Keep the feature declaration separate
from the code that applies changes.

1. Define the feature ID, metadata, direct dependencies, and capabilities.
2. Implement detection from current repository data.
3. Distinguish absent, exact, drifted, and ambiguous states.
4. Implement enable and disable preflight checks before mutations.
5. Return a structured plan with expected state and explicit changed paths.
6. Register the feature in `built-in-feature-registry.ts`.
7. Add lifecycle tests for enable, disable, repair, conflicts, and stale plans.
8. When action is needed, describe the feature's specific repair actions or
   required manual action in `hj repo features` output. Follow the
   `github-default-project` detail standard in the self-check above.
9. Run the self-check above and resolve ambiguity or drift on this repository.
10. Update the feature guide and run `deno task ci`.

Use existing artifact planners when the feature owns exact generated files.
Preserve custom files and report ambiguous data instead of adopting it. Test
behavior across a full operation when dependencies share files. Use temporary
Git repositories for filesystem and commit behavior. Inject GitHub responses and
clocks for remote failures, retries, and time limits.

## Generated tasks

Generated Deno task objects can contain descriptions and dependencies.
Independent checks run in parallel. Ordered mutations stay in one command. The
generated `default` task rebuilds and fixes files before checks. Its `check`
task is the normal aggregate, and `all` adds publishing checks when selected.
Generated lint tasks fix locally and check without fixes in CI. These names
differ from this repository's local development tasks above.

## Issue tracking

Keep proposed work and conditional ideas in
[GitHub issues](https://github.com/hugojosefson/cli/issues). The
[`cli` project](https://github.com/users/hugojosefson/projects/10/views/2)
contains every issue. Use area labels to identify affected code and `idea` for
proposals that need a decision. Record rejected alternatives as closed, not
planned issues with the `decision` label.

The project has Work, Board, Ideas, and Decisions views. `P1` identifies
foundational work, `P2` normal work, and `P3` optional work. Issue dependencies
identify prerequisites. Use short issue titles and put details in the body.

```bash
gh issue create --repo hugojosefson/cli --project cli
```

Use `hj repo features --github-default-project --yes` to add missing issues.

The EditorConfig feature was applied to this checkout with
`deno task hj repo features --editorconfig --yes`. Detection reported enabled,
and a second enable produced no changes. Its lifecycle tests cover custom
sections, edited values, removal, repair, and stale file guards.

## Local native npm build

Run `deno task npm-build` to build the native ESM CLI and its complete
dependency archive without publishing. Run
`node .hj/npm/esm/src/cli/cli.js --help` or
`bun .hj/npm/esm/src/cli/cli.js --help` to inspect it. Node 24+ and Bun 1.4.2+
run ordinary commands directly. External Deno remains necessary for Deno project
tasks. See [npm publication](npm-publication.md) for the frozen build toolchain,
final archive contract, and installation regression commands.

The combined checkout repeated
`deno task hj repo features --editorconfig --github-repo --yes` without changes.
The existing repository link and modern CI and release workflows need no
migration. The local npm build and its installed command passed their help
checks without publication. The scratchpad package was published, its public
archive passed installation checks, and repeated publisher commands verified the
same release.
