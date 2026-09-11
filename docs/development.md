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

[ci.yaml](../.github/workflows/ci.yaml) runs `deno task ci` for pushes, pull
requests, and manual requests. It reads the Deno version from `toolchain.json`.
It has read-only repository access and does not publish anything. Actions use
exact commit references.

The same toolchain file supplies Deno versions for newly generated CI and
release workflows. Generated workflows and README build tasks use the exact `hj`
package reference from `name` and `version` in `deno.json`, so a version change
also updates new workflow output. The legacy release template stays unchanged
because migration recognizes its exact bytes. To update Deno, edit the toolchain
file, install that version, and run `deno task ci`. A toolchain change can make
an existing generated workflow drifted. Repair remains an explicit feature
operation.

To run this repository's workflow locally with Docker and `act`, use:

```bash
act push -W .github/workflows/ci.yaml -j check \
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

The CLI was tested against this repository on 2026-09-11. Its status table
reports managed features, not a general inventory of programming languages. The
Details column explains custom configuration that cannot be adopted.

| Feature or group        | Expected state | Reason                                                                                                                        |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `git`                   | Enabled        | This is a Git repository.                                                                                                     |
| `readme-static`         | Enabled        | The root README is writable.                                                                                                  |
| `license-mit`           | Enabled        | LICENSE matches the MIT template and the README links to it.                                                                  |
| `deno-config-version`   | Enabled        | `deno.json` contains an exact SemVer version.                                                                                 |
| `deno-fmt`              | Enabled        | The `fmt` and `format` tasks provide formatting and its check.                                                                |
| `deno-lint`             | Enabled        | The `lint` task runs Deno lint on source and scripts.                                                                         |
| `deno-test`             | Enabled        | The `test` task uses the local test runner.                                                                                   |
| `deno-typecheck`        | Enabled        | The `typecheck` task checks source and scripts.                                                                               |
| `deno-cli`              | Enabled        | The explicit `./cli` export points to the CLI entry point.                                                                    |
| `jsr-package`           | Enabled        | Local package metadata, exports, and `publish-check` are configured. This does not mean the package is published.             |
| `deno-lib`              | Disabled       | The default export is the CLI. There is no library entry point.                                                               |
| `deno-server`           | Disabled       | This package does not provide a server.                                                                                       |
| `readme-build`          | Disabled       | The README does not need includes or generated sections.                                                                      |
| Other license providers | Disabled       | MIT is the chosen license.                                                                                                    |
| `github-ci`             | Disabled       | Local `ci.yaml` exists. The managed CI feature also adds dependency-update workflows and requires GitHub Actions permissions. |
| GitHub release features | Disabled       | Release workflows remain absent until publication is authorized.                                                              |
| Other GitHub features   | Disabled       | This repository has no linked GitHub repository. Remote settings cannot be treated as enabled.                                |

The local task names now match the feature conventions. `check` runs all
non-mutating checks, and `all` is its alias. CI runs coverage in place of the
standalone test task, so it collects tests once. The package keeps its default
CLI export for the documented installation command and adds an explicit `./cli`
export for detection.

Task detection accepts custom descriptions, file selections, and local runner
scripts. CLI detection reads the declared entry point. License detection ignores
group-write differences that Git does not preserve. These checks describe
configuration. `deno task ci` tests whether the configured operations succeed.

Keep the static README. It has one source, links to separate guides, and no
repeated fragments that need includes. Building it would add a generated file, a
source directory, and a versioned task without removing duplicated content.
Reconsider `readme-build` if the README needs shared fragments or generated
reference material.

Enabling a configured feature preserves its custom files. Removal and repairs
still check ownership before changing generated content. Missing GitHub features
remain disabled until publication is authorized.

## First public release

The README describes installation after the first JSR release. Registry
installation is not yet available. Publication remains a separate, authorized
step. Complete these checks before announcing the release:

| Preparation                  | State or next action                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Package identity and license | The package name, executable exports, and MIT license are present.                                                       |
| First version                | `0.1.0` is the current baseline. Tag preparation selects the release version. No tag exists here.                        |
| Release notes                | [CHANGELOG.md](../CHANGELOG.md) records supported features and known limits.                                             |
| Local validation             | CI includes coverage and a package dry run. Linux installation is tested.                                                |
| GitHub validation            | Disposable repositories exercise configuration and real release workflows. See the [record](live-validation.md).         |
| Bootstrap                    | Use [pinned first-release loading](releases.md#bootstrap-before-the-first-registry-version) until the CLI exists on JSR. |
| Publication                  | Follow the [first-release procedure](first-release.md) after separate authorization.                                     |
| JSR validation               | Account access, registry publication, registry installation, and provenance remain untested.                             |

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
