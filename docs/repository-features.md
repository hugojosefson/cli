# Repository features

A feature is one part of repository configuration. Use the
[installed CLI](../README.md#install) in the directory you want to manage.
Feature flags select changes independently:

```bash
hj repo features --deno-lib --deno-cli --no-deno-server
```

## Read the status table

`hj repo features` reports status without changes. The Details column explains
the observation behind each result. Detection checks the files that `hj` can
manage. It does not inventory every tool used by a custom project.

| State       | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `enabled`   | The feature recognizes its managed configuration.                                       |
| `disabled`  | The managed configuration is absent, or another recognized provider is active.          |
| `drifted`   | Recognized configuration differs from the managed form. Read the details before repair. |
| `ambiguous` | Data is custom, conflicting, unreadable, or unsupported. Automatic changes are blocked. |
| `unknown`   | No detection result is available.                                                       |

A working custom Deno task can be drifted. A custom CLI does not need to match
an `hj` starter project. For this repository's results, read the
[self-check record](development.md#self-check-and-readme-choice).

## Select changes

| Input                   | Effect                                                    |
| ----------------------- | --------------------------------------------------------- |
| No feature flags        | Report the current state.                                 |
| `--<feature>`           | Enable one feature and its required dependencies.         |
| `--no-<feature>`        | Disable one feature, if no enabled feature depends on it. |
| `--interactive` or `-i` | Select actions in a terminal checklist.                   |
| `--defaults`            | Select Git and the README capability.                     |
| `--repair`              | Repair every drifted feature.                             |
| `--repair --<feature>`  | Repair only the selected positive features.               |
| `--yes`                 | Accept plan warnings that require confirmation.           |

A capability is a function provided by a feature. The `readme` capability uses
its enabled provider, or `readme-static` by default. Required capabilities can
also select a default provider. Global default configuration is
[planned](planned.md#global-configuration).

The command changes only selected features and their required dependencies. It
stores no installation reason and has no automatic dependency removal. Disable
dependent features explicitly before removing their dependency.

Repair can restore starter code and tests. It does not adopt ambiguous files.
When Git is enabled, a successful local operation validates the plan and commits
only its planned paths in one Conventional Commit.

## Deno and Git features

| Feature               | Managed configuration                                                      | Requirement                                    |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `git`                 | Initialize Git and create an empty `chore: init repo` commit.              | Cannot be removed after commit history exists. |
| `deno-fmt`            | Formatting tasks and minimal configuration; create `deno.jsonc` if needed. | None.                                          |
| `deno-lint`           | A `lint` task that fixes locally and checks without fixes in CI.           | `deno-fmt`.                                    |
| `deno-typecheck`      | A `typecheck` task.                                                        | `deno-fmt`.                                    |
| `deno-test`           | A `test` task.                                                             | `deno-fmt`.                                    |
| `deno-lib`            | Library source and export.                                                 | `deno-fmt`.                                    |
| `deno-cli`            | Executable source and command registry.                                    | `deno-fmt`.                                    |
| `deno-server`         | A minimal `Deno.serve` server.                                             | `deno-fmt`; integrates with an enabled CLI.    |
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

`jsr-package` derives `@owner/repository` from the linked GitHub repository and
starts at version `0.0.0`. It owns a `publish-check` task and the generated
check aggregate. Existing custom package metadata alone does not mean this
feature is adopted.

| Requirement   | Purpose                        |
| ------------- | ------------------------------ |
| `deno-fmt`    | Manage Deno tasks.             |
| `github-repo` | Derive package identity.       |
| A Deno export | Provide a package entry point. |
| `readme`      | Provide package documentation. |
| `license`     | Provide a complete license.    |

The managed check command is `deno publish --dry-run --check=all`. Connecting
the package to GitHub remains an external publishing prerequisite. Interactive
license selection defaults to MIT and offers no unlicensed choice.

Attribution is resolved in this order:

| Priority | Source             |
| -------- | ------------------ |
| 1        | GitHub identity    |
| 2        | Git configuration  |
| 3        | Interactive prompt |

Setup stops if required attribution remains unresolved. For release setup and
removal, read the [release guide](releases.md).
