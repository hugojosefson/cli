# Development

This guide describes work on `hj` itself. The
[feature guide](repository-features.md) describes files and tasks that `hj` adds
to other repositories. Use the [Deno](https://deno.com/) version in
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
| `deno task ci`                                                 | Run the checks and enforce coverage limits.                   |
| `deno task test src/release/publish-tag-orchestration_test.ts` | Run one test file.                                            |
| `deno task test --filter "recovery"`                           | Run tests with matching names.                                |
| `deno task coverage`                                           | Run the suite and print coverage.                             |
| `deno task coverage-html`                                      | Build `.coverage/html/index.html` from the last coverage run. |

Tests use temporary repositories under `/tmp/opencode` and remove their own
fixtures. The test runner creates the parent directory on a fresh machine. It
grants subprocess access to Git and Deno. Tests do not need GitHub credentials.
The local runners remove dynamic-loader overrides from child environments. This
prevents restricted Deno subprocesses from failing when a development shell sets
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

`deno task package-check` runs `deno publish --dry-run` with full type checks
and the frozen lockfile. It never uploads the package. CI includes this check.
The package exports only the CLI executable, not a supported library API. Its
file list includes runtime source, the toolchain version, license, and docs.
Tests and test fixtures stay outside the package.

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

`validate-feature-registry.ts` checks feature declarations.
`resolve-feature-changes.ts` provides the pure resolver.
`resolve-registry-changes.ts` selects dependencies and capability providers.
`order-feature-changes.ts` orders operations. The resolver does not write files,
keep feature history, or remove unused dependencies.

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

## First public release

The README describes installation after the first JSR release. Registry
installation is not yet available. Publication remains a separate, authorized
step. Complete these checks before announcing the release:

| Preparation                  | State or next action                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Package identity and license | The package name, executable export, and MIT license are present.                                                              |
| First version                | Replace the development version `0.0.0` in `deno.json` with the selected release version. New workflows use this same version. |
| Release notes                | Record the initial supported features and known limits.                                                                        |
| Validation                   | Run `deno task ci`, including the package dry run. Test installation on each supported operating system.                       |
| JSR access                   | Confirm access to the `hugojosefson` scope and the `cli` package name on [JSR](https://jsr.io/).                               |
| Repository publication       | Create the public repository only when authorized. Configure branch protection and allow rebase merges only.                   |
| Package publication          | Connect the package to its public repository and publish the selected version when authorized.                                 |
| Registry installation        | Run the README command in a clean environment and check help and a local feature operation.                                    |
| Release workflows            | Complete the [remaining live validation](planned.md#remaining-live-validation) in scratchpad.                                  |

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
