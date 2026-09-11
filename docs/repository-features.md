# Repository features

A feature is one part of repository configuration. Use the
[installed CLI](../README.md#install) in the directory you want to manage. A
preset selects a group of features with one flag. Use `--defaults` for Git and
README:

```bash
hj repo features --defaults
```

For an existing linked GitHub repository, authenticate with `gh auth login`
before applying GitHub presets:

```bash
# Apply common GitHub settings with public visibility.
hj repo features --github --github-public --yes
# Protect the default branch and tags.
hj repo features --github-protection --yes
```

Explicit feature flags override presets regardless of argument order. Feature
flags also select changes independently:

```bash
hj repo features --deno-lib --deno-cli --no-deno-server
```

## Output

`hj` prints aligned tables for structured results. Status words remain visible
with or without color. It measures columns before it adds color, so both forms
have the same alignment.

| Element or state             | Appearance                                          |
| ---------------------------- | --------------------------------------------------- |
| Table headings               | Bold                                                |
| Commands and flags           | Cyan                                                |
| Enabled features             | Normal details, cyan names, and green status words. |
| Drifted features             | Yellow names, status words, and details.            |
| Ambiguous features           | Red names, status words, and details.               |
| Disabled or unknown features | Dim names, status words, and details.               |
| Completed changes            | Green                                               |
| Warnings                     | Yellow                                              |
| Errors                       | Red                                                 |
| Separators                   | Dim                                                 |

Row styles also apply to wrapped details.

The CLI checks stdout and stderr separately. Redirected output and pipes use
plain text by default. Generated README content always keeps its exact bytes.
Color affects human messages, not release data written to workflow files.

Color controls follow
[Deno's color policy](https://github.com/denoland/deno_terminal/blob/main/src/colors.rs):

| Control             | Behavior                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `NO_COLOR=1`        | Disable color and text styles. Any nonempty value has this effect.                               |
| `TERM=dumb`         | Disable color and text styles.                                                                   |
| `FORCE_COLOR=1`     | Force color, including in pipes. Any nonempty value overrides `NO_COLOR` and `TERM`, as in Deno. |
| Empty `FORCE_COLOR` | Use normal terminal detection and the other controls.                                            |

To disable color, unset `FORCE_COLOR` before you set `NO_COLOR`. Unlike some
Node tools, Deno treats `FORCE_COLOR=0` as a request for color. When running
source with restricted permissions, allow `TERM` reads for automatic color
detection. Without that permission, `hj` uses plain text unless color is forced.
Help does not request extra permissions. The installed command and
`deno task hj` already have the required permission.

## Read the status table

`hj repo features` reports status without changes. The Details column explains
the observation behind each result. Detection reads configuration and local
files. It does not run project tasks or prove that tests pass or a package is
published.

| State       | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `enabled`   | The feature recognizes usable configuration or its generated files.                     |
| `disabled`  | The managed configuration is absent, or another recognized provider is active.          |
| `drifted`   | Required configuration is incomplete or unrecognized. Read the details before repair.   |
| `ambiguous` | Data is custom, conflicting, unreadable, or unsupported. Automatic changes are blocked. |
| `unknown`   | No detection result is available.                                                       |

Deno tasks can use strings or objects, custom descriptions, and file selections.
Detection follows simple task aliases and dependencies. It also recognizes local
Deno runner scripts. Missing scripts, missing tasks, cycles, and unsupported
commands do not count as configured tasks. The formatter needs both `fmt` and
`format`; the direct `format` command must include `--check`.

A declared `./cli` export counts as configured when it points to a nonempty
local file. The source does not need to match the generated starter. If the
default export points to the same CLI, it does not also count as a library.

Enabling an already configured feature preserves its custom tasks and code.
Automatic removal and repair still use exact ownership checks. A feature can
therefore be enabled while its custom files remain protected from automatic
removal. For this repository's results, read the
[self-check record](development.md#self-check-and-readme-choice).

## Select changes

| Input                   | Effect                                                      |
| ----------------------- | ----------------------------------------------------------- |
| No feature flags        | Report the current state.                                   |
| `--<feature>`           | Enable one feature and its required dependencies.           |
| `--no-<feature>`        | Disable one feature, if no enabled feature depends on it.   |
| `--interactive` or `-i` | Select actions in a terminal checklist.                     |
| `--defaults`            | Select Git and the README capability.                       |
| `--github`              | Apply common GitHub settings, including private visibility. |
| `--github-protection`   | Select default-branch protection and protected tags.        |
| `--github-public`       | Select public visibility; overrides `--github` visibility.  |
| `--repair`              | Repair every drifted feature.                               |
| `--repair --<feature>`  | Repair only the selected positive features.                 |
| `--yes`                 | Accept plan warnings that require confirmation.             |

A capability is a function provided by a feature. The `readme` capability uses
its enabled provider, or `readme-static` by default. Required capabilities can
also select a default provider. Global default configuration is
[planned](planned.md#global-configuration).

The command changes only selected features and their required dependencies. It
stores no installation reason and has no automatic dependency removal. Disable
dependent features explicitly before removing their dependency.

Repair can restore starter code and tests. It does not adopt ambiguous files.
When Git is enabled, a successful local operation validates the plan and commits
only its planned paths in one Conventional Commit. This also applies when the
operation initializes Git. Git alone creates an empty `chore: init repo` commit.
Git with file changes creates one `chore: configure repository features` commit
that contains those files. Before any changes, `hj` checks that Git can identify
the author and committer. If either identity is unavailable, the command stops
and explains how to set it.

## Deno and Git features

| Feature               | Managed configuration                                                      | Requirement                                    |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `git`                 | Initialize Git and create the first commit.                                | Cannot be removed after commit history exists. |
| `deno-fmt`            | Formatting tasks and minimal configuration; create `deno.jsonc` if needed. | None.                                          |
| `deno-lint`           | A `lint` task that fixes locally and checks without fixes in CI.           | `deno-fmt`.                                    |
| `deno-typecheck`      | A `typecheck` task.                                                        | `deno-fmt`.                                    |
| `deno-test`           | A `test` task.                                                             | `deno-fmt`.                                    |
| `deno-lib`            | Library source and export.                                                 | `deno-fmt`.                                    |
| `deno-cli`            | Executable source and command registry.                                    | `deno-fmt`.                                    |
| `deno-server`         | A `deno serve` module with `serve` and `dev` tasks.                        | `deno-fmt`; integrates with an enabled CLI.    |
| `deno-config-version` | A release version from one Deno configuration.                             | An exact SemVer version, such as `1.2.3`.      |

Git is not required by the Deno project or formatting features. The Deno
features can coexist. With no enabled features, `hj` creates nothing.

| Feature       | Source                 | Export     |
| ------------- | ---------------------- | ---------- |
| `deno-lib`    | `src/lib/mod.ts`       | `.`        |
| `deno-cli`    | `src/cli/cli.ts`       | `./cli`    |
| `deno-server` | `src/server/server.ts` | `./server` |

Generated tests live under `test/`. When the CLI and server coexist, the server
contributes a `serve` command to the CLI registry. Neither feature patches the
other's custom source.

## Start a Deno server

In an empty directory, create the server project:

```bash
hj repo features --deno-server
```

The server module exports the standard `{ fetch }` object. It does not open a
listener when another module imports it.
[Deno serve](https://docs.deno.com/runtime/reference/cli/serve/) starts the
listener.

| Command                                         | Behavior                                                 |
| ----------------------------------------------- | -------------------------------------------------------- |
| `deno task serve`                               | Start the server on port 8000.                           |
| `deno task dev`                                 | Start on port 8000 and restart when source files change. |
| `deno serve ./src/server/server.ts`             | Start the same module directly.                          |
| `deno serve --port=3000 ./src/server/server.ts` | Use another port.                                        |
| `./src/cli/cli.ts serve`                        | Start on port 8000 when the CLI feature is enabled.      |
| `deno test test/server_test.ts`                 | Test the response without starting a listener.           |

Open `http://localhost:8000/` to see the response. Stop the server with Ctrl+C.
For Deno flags such as `--port`, use the direct command with flags before the
file path. Deno does not accept `deno serve .` as a directory entry point.

| Generated file             | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `src/server/server.ts`     | Handle HTTP requests through the default export.                   |
| `test/server_test.ts`      | Test that default export.                                          |
| `src/cli/serve-command.ts` | Adapt the server to the CLI, only when the CLI feature is enabled. |

The tasks call `deno serve` directly. The development task adds `--watch`. The
optional CLI adapter uses the same fetch handler and stays active until the
server stops. With both features enabled, the executable CLI includes
`--allow-net=0.0.0.0:8000`. This
[Deno permission](https://docs.deno.com/runtime/fundamentals/security/) lets it
start without a permission prompt. When you use `deno run` directly, pass that
flag before the CLI file path.

Disabling the server removes its exact tasks, export, and network flag from the
generated CLI launcher. It preserves source files. Custom tasks or launchers
block automatic changes.

To update an older generated starter, run
`hj repo features --repair --deno-server`. This replaces generated server files
and the `serve` and `dev` tasks, so preserve custom changes before repair.
Repair also migrates the old generated CLI adapter to `src/cli/` when needed. It
removes the old adapter only when its content and mode are unchanged. It also
adds the network flag to an unchanged generated CLI launcher.

## README and license features

| Feature         | Behavior                                                           |
| --------------- | ------------------------------------------------------------------ |
| `readme-static` | Use a writable root `README.md`; the default README provider.      |
| `readme-build`  | Build the root README from Markdown includes; requires `deno-fmt`. |
| `license-*`     | Manage one recognized license and its README link.                 |

Only one README provider and one license provider can be enabled at a time. The
license catalog covers these families:

| Family                   | Providers       |
| ------------------------ | --------------- |
| Permissive               | MIT             |
| Permissive               | Apache-2.0      |
| Permissive               | ISC             |
| Permissive               | BSD-2-Clause    |
| Permissive               | BSD-3-Clause    |
| Copyleft                 | GPL-2.0-only    |
| Copyleft                 | GPL-3.0-only    |
| Copyleft                 | AGPL-3.0-only   |
| Copyleft                 | MPL-2.0         |
| Public-domain dedication | Unlicense       |
| Creative Commons         | CC0-1.0         |
| Creative Commons         | CC-BY-4.0       |
| Creative Commons         | CC-BY-SA-4.0    |
| Creative Commons         | CC-BY-ND-4.0    |
| Creative Commons         | CC-BY-NC-4.0    |
| Creative Commons         | CC-BY-NC-SA-4.0 |
| Creative Commons         | CC-BY-NC-ND-4.0 |

License detection requires the pinned template and its recognized README link. A
different line wrap or a custom license section can prevent adoption.
Recognition is a file-management check, not a legal assessment.

| README transition                                   | Result                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Static to built                                     | Copy the writable README into `readme/`, then replace the root with generated output. |
| Built to static                                     | Keep the generated content as a writable root README and remove the source directory. |
| Remove a clean source directory tracked by Git      | No extra confirmation is needed.                                                      |
| Remove a dirty source directory, or one outside Git | Show a warning and require confirmation; `--yes` accepts it.                          |

## GitHub features

GitHub operations require [GitHub CLI](https://cli.github.com/) authentication
and an existing repository link. These features do not create repositories.

| Feature                         | Behavior                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `github-repo`                   | Detect authenticated access to the linked GitHub repository.                                                |
| `github-*` settings             | Manage individual repository settings. See the preset table below.                                          |
| `github-ci`                     | Add PR checks and nightly or manual dependency updates; requires `github-repo` and `deno-fmt`.              |
| `github-main-protection`        | Require PRs and generated checks on the default branch; block deletion and force-pushes.                    |
| `github-main-review`            | Require one approval after the last push; dismiss stale approvals. Admin bypass applies only through a PR.  |
| `github-protected-tags`         | Apply the layered tag rules described in the [release guide](releases.md#tag-policy).                       |
| `github-protection`             | Select main protection and protected tags. Keep an enabled review layer without selecting it automatically. |
| `github-release-publish-tag`    | Prepare release PRs and lightweight tags; conflicts with `github-main-review`.                              |
| `github-release-publish-jsr`    | Publish through temporary GitHub identity credentials; requires `jsr-package`.                              |
| `github-release-publish-github` | Create the GitHub Release after tag publication.                                                            |

`github-ci` also requires the Actions setting that allows PR creation and
approval. PR workflow runs created by its dependency updater need approval from
a user with write access. `github-main-protection` requires `github-ci` and
resolved review threads.

## GitHub preset

`--github` uses fixed defaults. It does not inspect recent repositories.

| Setting                | Preset value |
| ---------------------- | ------------ |
| Auto-merge             | Enabled      |
| Delete merged branches | Enabled      |
| Squash merges          | Enabled      |
| Rebase merges          | Enabled      |
| Issues                 | Enabled      |
| Projects               | Enabled      |
| Branch updates         | Enabled      |
| Visibility             | Private      |
| Merge commits          | Disabled     |
| Wiki                   | Disabled     |
| Discussions            | Disabled     |
| Web commit signoff     | Disabled     |

| Override or constraint          | Rule                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Explicit setting flags          | Override the preset regardless of argument order.                             |
| `--github-public`               | Makes the preset public unless an explicit private-setting flag overrides it. |
| More-specific preset IDs        | Override a selected prefix preset.                                            |
| Unrelated contradictory presets | Fail as ambiguous.                                                            |
| Merge-message enum settings     | Remain unchanged.                                                             |
| Remote changes                  | Require `--yes` and use a guarded API update.                                 |
| `--no-github`                   | Invalid.                                                                      |
| `--no-github-repo`              | Blocked; repository deletion is unsupported.                                  |

## JSR package feature

`jsr-package` detects local package configuration without GitHub access. It
requires a valid scoped name, an exact SemVer version, local export paths, and a
configured `publish-check` task. The task can use a local runner. A direct
`deno publish` command must include `--dry-run`.

| Requirement   | Purpose                        |
| ------------- | ------------------------------ |
| `deno-fmt`    | Manage Deno tasks.             |
| A Deno export | Provide a package entry point. |
| `readme`      | Provide package documentation. |
| `license`     | Provide a complete license.    |

For new managed configuration, `hj` derives `@owner/repository` from a linked
GitHub repository and starts at version `0.0.0`. That operation still requires
GitHub access. It creates the exact `deno publish --dry-run --check=all` task
and adds it to the generated check aggregate. Custom aggregates do not change
the local package status. Removing managed configuration still requires an exact
match.

Connecting and publishing the package are separate operations. Interactive
license selection defaults to MIT and offers no unlicensed choice.

Attribution is resolved in this order:

| Priority | Source             |
| -------- | ------------------ |
| 1        | GitHub identity    |
| 2        | Git configuration  |
| 3        | Interactive prompt |

Setup stops if required attribution remains unresolved. For release setup and
removal, read the [release guide](releases.md).
