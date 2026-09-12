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
| `deno task all`                                                | Run all checks without coverage collection.                   |
| `deno task typecheck`                                          | Type-check source and scripts with frozen dependencies.       |
| `deno task publish-check`                                      | Validate the package without uploading it.                    |
| `deno task check`                                              | Run all checks without coverage collection.                   |
| `deno task ci`                                                 | Run the checks and enforce coverage limits.                   |
| `deno task test src/release/publish-tag-orchestration_test.ts` | Run one test file.                                            |
| `deno task test --filter "recovery"`                           | Run tests with matching names.                                |
| `deno task coverage`                                           | Run the suite and print coverage.                             |
| `deno task coverage-html`                                      | Build `.coverage/html/index.html` from the last coverage run. |

Tests use temporary repositories under `/tmp/opencode` and remove their own
fixtures. The test runner creates the parent directory on a fresh machine. It
grants subprocess access to Git and Deno. Server tests make HTTP requests over
the local loopback interface and test watch restarts. Network permissions are
limited to `127.0.0.1`. Tests do not need GitHub credentials. The local runners
remove dynamic-loader overrides from child environments. This prevents
restricted Deno subprocesses from failing when a development shell sets
`LD_LIBRARY_PATH`.

Run one coverage collection at a time. Each collection clears `.coverage` first.
Coverage limits live in [deno.json](../deno.json), not in a second CI
configuration. The report excludes test files and shared test fixtures. Deno
reports loaded modules, so the total does not prove that every executable path
has a test. The executable has a separate smoke test for help without
application permissions.

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

Run `hj repo features` to inspect this checkout. Every registered feature is
assessed below. Disabled features are intentional when they provide an
alternative or a service that this CLI does not use. Remote states require
GitHub access, so an unauthenticated visitor can receive different results.

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
| `git-ignore`                    | Disabled       | Existing custom exclusions remain unowned until this feature is selected.                                 |
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
| `readme-build`                  | Disabled       | The static README has no shared fragments or generated sections that need a build.                        |
| `readme-static`                 | Enabled        | Visitors read the maintained root README directly.                                                        |

All four managed workflow features are enabled. They can pin an earlier exact
CLI version without being drifted. Detection still compares the complete
workflow with its managed template. Changing permissions, commands, actions, or
other content requires repair. To select the current CLI version explicitly, use
the
[workflow source option](releases.md#bootstrap-before-the-first-registry-version).

`check` runs non-mutating checks. `all` depends on `ci`, which enforces coverage
limits. CI collects tests once through the coverage task. Detection accepts the
project's custom file selections and runner scripts. A configured task is not
proof that its checks pass. The CI result supplies that proof.

Keep the static README. It links to separate guides and has no duplicated
fragments that need includes.

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
8. Update the feature guide and run `deno task ci`.

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
