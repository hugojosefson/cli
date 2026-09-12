# Repository features

A feature is one part of repository configuration. Use the
[installed CLI](../README.md#install) in the directory you want to manage. A
preset selects a group of features with one flag. Use `--defaults` for Git and
README:

```bash
hj repo features --defaults
```

For an existing linked GitHub repository, authenticate with
`gh auth login --scopes project` before applying GitHub presets:

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

A disabled feature is not a failed check. This CLI repository intentionally
omits server and library entry points and uses one license and one README
provider. See the
[assessment of this repository](development.md#self-check-and-readme-choice) for
every feature and its expected state.

Managed workflows can retain an earlier exact JSR CLI version. That pin alone
does not mean drift. Other workflow content must still match the managed
template. Use `--repair --workflow-cli=jsr` with the selected workflow features
to update their CLI pin explicitly.

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
also select a default provider.

The command changes only selected features and their required dependencies. It
stores no installation reason and has no automatic dependency removal. Disable
dependent features explicitly before removing their dependency.

Repair can restore starter code and tests. It does not adopt ambiguous files.
When Git is enabled, `hj` records one commit for each changed feature after the
final project task and validation succeed. Subjects identify the feature, such
as `chore(deno-test): enable feature` or `chore(readme-build): disable feature`.
Repairs use the enable subject. Changes to shared files remain separated in
history. Unchanged features do not create commits.

Before writing files, `hj` requires both Git identities and checks that planned
paths have no existing edits. Unrelated staged and working files stay untouched.
A repository without commits receives an empty `chore: init repo` base before
feature content. That empty commit may remain if a task fails; pending feature
commits are created only after success. Unattributable task output stops commit
creation and remains visible for correction. Generated coverage reports are not
feature content.

After local file changes, `hj` runs `deno task default` once before it creates
feature commits. It uses the final task definition and the final project files.
This includes feature removals and changes to source files, imports, README
inputs, configuration, lockfiles, and file modes. Read-only inspection and
operations without local file changes do not run the task. If no `default` task
remains, `hj` reports that result.

If the task fails, `hj` returns its exit code and leaves the changes visible. It
does not create the pending feature commits. An empty initial commit can remain.
Correct the reported failure before you commit the changes.

Deno can reject a recently published helper package under its minimum dependency
age policy. If this occurs, wait until the required version meets the policy,
then retry. `hj` does not lower that policy.

## Deno and Git features

| Feature               | Managed configuration                                                      | Requirement                                    |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `git-ignore`          | Ignore editor swap files and configured generated directories.             | Independent of Git and Deno features.          |
| `git`                 | Initialize Git and create the first commit.                                | Cannot be removed after commit history exists. |
| `deno-fmt`            | Formatting tasks and minimal configuration; create `deno.jsonc` if needed. | None.                                          |
| `deno-lint`           | A `lint` task that fixes locally and checks without fixes in CI.           | `deno-fmt`.                                    |
| `deno-typecheck`      | A `typecheck` task.                                                        | `deno-fmt`.                                    |
| `deno-test`           | Test coverage and test watching tasks.                                     | `deno-fmt`.                                    |
| `deno-lib`            | Library source and export.                                                 | `deno-fmt`.                                    |
| `deno-cli`            | Executable source and command registry.                                    | `deno-fmt`.                                    |
| `deno-server`         | A `deno serve` module with `serve` and `dev` tasks.                        | `deno-fmt`; integrates with an enabled CLI.    |
| `deno-config-version` | A release version from one Deno configuration.                             | An exact SemVer version, such as `1.2.3`.      |

A lockfile records resolved dependency versions. The shared `deno-fmt`
configuration sets `lock: false` for libraries and other projects without a
lockfile requirement. Enabling `deno-cli` or `deno-server` sets the managed
value to `true`. Removing the last application feature restores `false`. A
pre-existing explicit `lock: true` remains a separate requirement and stays
enabled.

Before project tasks run, `hj` generates or updates its owned `deno.lock` from
the project's JavaScript and TypeScript files. This includes test dependencies
and allows frozen dependency checks to run. The feature commit includes the
resulting lockfile and its ownership record, `.hj/deno-lock.json`.

The ownership record stores the last generated file digest, a fingerprint of its
contents. `hj` removes an owned lockfile only while that digest still matches.
Existing lockfiles, custom paths, custom lock options, and edited lockfiles stay
outside automatic replacement or removal. Remove `.hj/deno-lock.json` to release
ownership and retain an explicit `lock: true` requirement. An unrecognized
ownership record blocks changes until you resolve it.

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

`git-ignore` adds `.*.swp` to `.gitignore`. It adds `/coverage/` when a task
collects coverage in `coverage`, and `/node_modules/` when configuration uses
that directory. Deno `nodeModulesDir` values `true`, `auto`, and `manual` select
the directory. A `package.json` also selects it, except with Deno `false` or
`none`, or an explicit `installConfig.pnp: true` setting.

The feature marks each owned entry with a comment. It preserves custom lines and
removes only unchanged owned entries. Related feature changes recompute the
conditional entries from the resulting configuration. You can select or remove
`git-ignore` independently. It adds no blanket editor-directory or log
exclusions.

## Package names in generated files

Generated CLI help uses the configured package name. The command uses its
package component. For example, `@acme/fancy-tool` uses the command
`fancy-tool`. Set `"hj": { "commandName": "other-command" }` in the Deno
configuration to override only the command name.

The generated `package-metadata` task builds `src/cli/package-metadata.json`
from the Deno configuration. Generated CLI code imports this file relative to
its own module. An installed command therefore uses its own package name without
runtime file permissions, even inside another project.

After changing the configured name, run `deno task default`. This command builds
package metadata before formatting, README generation, and checks. To rebuild
only metadata, run `deno task package-metadata`. Include the generated metadata
file when publishing the CLI. Older starters need explicit `--repair` for the
`deno-cli` and `deno-fmt` features to install these build steps.

Keep package references in `readme/README.md` so each build resolves the current
name. New generated README headings use `# {{package.name}}`. Custom text stays
unchanged. The supported references are:

| Source reference      | Built content                                              |
| --------------------- | ---------------------------------------------------------- |
| `{{package.name}}`    | Configured package name, or the normalized directory name. |
| `{{package.command}}` | Command name, including an explicit override.              |
| `{{package.url}}`     | JSR package page.                                          |
| `{{package.api}}`     | JSR API documentation URL.                                 |
| `{{package.badge}}`   | JSR badge image URL.                                       |
| `{{package.install}}` | Global Deno installation command for the CLI export.       |
| `{{package.run}}`     | Published CLI example command.                             |

Registry references require a configured scoped name. Included TypeScript
examples use package imports only for exact exports of that configured package.
Source files and references remain available for the next build.

## Run tests with coverage

The generated `test` task removes the previous `coverage/` directory before each
run. It runs `deno test --parallel --trace-leaks --coverage=coverage`, then
`deno coverage coverage`. Coverage shows which source lines the tests run. The
report includes available coverage when tests fail. A test failure keeps its
exit code. If tests pass but the report fails, the task fails.

Run `deno task test` for tests and a fresh report. The `coverage` task calls the
same task, so `deno task coverage` also starts a fresh run. Extra arguments pass
to Deno tests, for example `deno task test --filter "my test"`. Run one coverage
collection at a time. The generated default task and GitHub CI both reach this
same test task through `check`.

The generated `dev` task runs `deno test --parallel --trace-leaks --watch`.
Watch mode runs continuously and does not collect coverage. If a server or
custom task already uses `dev`, test watching uses `dev:test`. Removing the
server restores test watching to `dev`. Existing custom test commands remain
configured. To update an older generated test task, run
`hj repo features --deno-test --repair`.

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

| README transition                                   | Result                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Static to built                                     | Copy the writable README into `readme/`, then replace the root with generated output.          |
| Built to static                                     | Keep a writable root README. Preserve shared example files when contribution ownership exists. |
| Remove a clean source directory tracked by Git      | No extra confirmation is needed.                                                               |
| Remove a dirty source directory, or one outside Git | Show a warning and require confirmation; `--yes` accepts it.                                   |

### Generated guides

A contribution is a README block supplied by one feature. The selected README
provider collects these blocks during feature operations. Existing headings,
introductions, license sections, and custom blocks stay intact.

| Owner                         | Contribution                                                     |
| ----------------------------- | ---------------------------------------------------------------- |
| `jsr-package`                 | JSR version and score badges, API link, and `readme/install.sh`. |
| `github-ci`                   | CI badge for the linked repository and `hj-ci.yaml`.             |
| Deno features                 | A requirement for Deno, through the active README provider.      |
| `deno-cli` with `jsr-package` | Command installation when the package has a `./cli` export.      |
| `deno-lib` with `jsr-package` | A runnable example, its public export, and a link to the tests.  |

Static READMEs contain the installation commands and example code directly.
Built READMEs keep standalone include directives in `readme/README.md`. The
build removes shell shebangs and changes matching library imports to the
configured package name. Local examples keep relative imports so they run from
clones too.

The generated library example calls `placeholder()` and prints its result.
Readers can run the public example after the package is published:

```sh
deno run --reload jsr:@scope/package/example-usage
```

From a clone, readers can run `deno run readme/example-usage.ts`. Command-only
packages omit library examples. Existing example files and export targets stay
intact. Custom libraries need an existing example because `hj` cannot infer
which public function to call.

Ownership markers identify each generated block and its original content. The
`.hj/readme.json` file records the original installation and example files. Keep
this file in Git. Disabling a feature removes only its unchanged blocks and
files. A customized public example keeps its export. Switching README providers
keeps the shared installation and example files.

After a package rename, run `hj repo features --jsr-package --yes` to refresh
owned guides and installation files. The README build also resolves current
package references in owned installation includes. It preserves customized
scripts. The generated heading stays linked to the package name, while a custom
heading stays unchanged.

## GitHub features

GitHub operations require [GitHub CLI](https://cli.github.com/) authentication
and an existing repository link. These features do not create repositories.

| Feature                         | Behavior                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `github-repo`                   | Detect authenticated access to the linked GitHub repository.                                                 |
| `github-default-project`        | Link a default project and add all repository issues; requires `github-projects` and GitHub project access.  |
| `github-*` settings             | Manage individual repository settings. See the preset table below.                                           |
| `github-ci`                     | Add PR checks and nightly or manual dependency updates; requires `github-repo` and `deno-fmt`.               |
| `github-main-protection`        | Require PRs and generated checks on the default branch; block deletion and force-pushes.                     |
| `github-main-review`            | Require one approval after the last push; dismiss stale approvals. Admin bypass applies only through a PR.   |
| `github-protected-tags`         | Apply the layered tag rules described in the [release guide](releases.md#tag-policy).                        |
| `github-protection`             | Select main protection and protected tags. Keep an enabled review layer without selecting it automatically.  |
| `github-release-publish-tag`    | Prepare release PRs and lightweight tags; conflicts with `github-main-review`.                               |
| `github-release-publish-jsr`    | Publish automatically after tag creation with temporary GitHub identity credentials; requires `jsr-package`. |
| `github-release-publish-github` | Create the GitHub Release after tag publication.                                                             |

`github-ci` also requires the Actions setting that allows PR creation and
approval. PR workflow runs created by its dependency updater need approval from
a user with write access. `github-main-protection` requires `github-ci` and
resolved review threads.

## GitHub preset

`--github` uses fixed defaults. It does not inspect recent repositories.

| Setting                | Preset value                       |
| ---------------------- | ---------------------------------- |
| Auto-merge             | Enabled                            |
| Delete merged branches | Enabled                            |
| Squash merges          | Enabled                            |
| Rebase merges          | Enabled                            |
| Issues                 | Enabled                            |
| Projects               | Enabled                            |
| Default project        | Linked, with all repository issues |
| Branch updates         | Enabled                            |
| Visibility             | Private                            |
| Merge commits          | Disabled                           |
| Wiki                   | Disabled                           |
| Discussions            | Disabled                           |
| Web commit signoff     | Disabled                           |

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

The workflow source option supports first publication before `hj` exists on JSR.
Use `--workflow-cli=github:owner/repository@<commit SHA>` with selected workflow
features. Use `--repair --workflow-cli=jsr` to switch them to the registry. The
[release guide](releases.md#bootstrap-before-the-first-registry-version) owns
the setup procedure and source rules.

## Default GitHub project

`--github` selects `github-default-project` alongside the repository settings.
`--github-projects` controls only the Projects setting. To omit project setup,
use `--github --no-github-default-project`.

The feature reuses a project with the repository name under the repository
owner. Otherwise, it uses the only linked project or creates a repository-named
project. Multiple candidates, closed projects, and conflicting fields block
changes. New projects start private. Existing project visibility stays
unchanged.

Projects need the `project` scope in addition to repository access. If GitHub
rejects project access, refresh the login:

```bash
gh auth refresh -h github.com -s project
hj repo features --github-default-project --yes
```

Setup links the project and adds every missing repository issue, including
closed issues. New projects start on a `Board` view and include a `Work` table.
Setup converts GitHub's untouched `View 1` into Board. It preserves other saved
views and supplies any missing Board or Work view. Status output links directly
to Board. GitHub's repository Projects tab still lists linked projects.

The default status order is `Backlog`, `Todo`, `In Progress`, and `Done`. Setup
adds Backlog before Todo, or moves an existing Backlog before Todo. It preserves
existing status option IDs, colors, descriptions, and issue assignments. A
custom status scheme without Todo stays unchanged. Priorities are `P1`, `P2`,
and `P3`. Newly added open issues enter Todo. Closed issues enter Done. Existing
item statuses and priorities stay unchanged.

The `Area` text column contains values from `area:*` issue labels. For example,
`area:cli` and `area:github` produce `cli, github`. Work and Board show Area
beside Title. Setup updates this derived column when labels change and clears it
when no area labels remain. It preserves the source labels and other fields.
Newly auto-added issues receive Area values on the next explicit setup run.
Repeated setup adds no duplicate project items or views.

Create an issue with its project selected:

```bash
gh issue create --project <project-title>
```

To assign new issues automatically, use the optional browser command:

```bash
hj repo project-auto-add --yes
```

First, quit Firefox normally and restart it with
`firefox --remote-debugging-port=9222`. Sign in to GitHub in that Firefox
session. The command connects to `ws://127.0.0.1:9222/session` and opens a
temporary tab. It uses the default project and sets the repository filter to
`is:issue`. Firefox requires the startup flag to
[enable its automation connection](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection).
The command leaves the browser and its other tabs open.

Setup first tries GitHub's undocumented workflow endpoint in the signed-in tab.
If GitHub removes or rejects that endpoint with HTTP 404, 405, or 410, setup
uses the visible workflow controls. Select `--method=endpoint` or
`--method=browser` to use one route directly. Use
`--browser-url=ws://127.0.0.1:<port>/session` for a different local Firefox
port. The command does not copy browser credentials or use the `gh` token for
browser requests.

An enabled matching workflow requires no change. A disabled matching workflow is
enabled. Custom filters, duplicate workflows, access failures, and uncertain
writes stop setup for review. Setup reads the saved workflow again before it
reports success. GitHub can change both the endpoint and the page controls.

The public API does not expose creation of this workflow. Ordinary feature
checks use the public API and require no browser. The default project feature
reports missing issues as drift. Run its setup command again to add them.
GitHub's
[auto-add workflow](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically)
applies to new or updated items. Existing issues still need the initial project
setup or `gh issue create --project <project-title>`.

`--no-github-default-project --yes` unlinks the project. It preserves the
project, its fields, and its items. To disable the Projects setting too, also
select `--no-github-projects`.

## JSR preset and package feature

`--jsr` selects package configuration, the Deno version provider, and the JSR
release workflow. Their dependencies select CI, release tags, and repository
protection. Use this preset after the
[release setup requirements](releases.md#setup-and-workflow-roles) are ready. It
requires an existing Deno export and version, or a separate package setup first.

```bash
hj repo features --jsr --yes
```

The preset preserves repository visibility and does not select GitHub Release
creation. Add `--github-release-publish-github` when you want that publisher
too. The JSR workflow starts automatically after tag creation. Require CI
publication and permit the release bot in the
[JSR scope settings](releases.md#jsr-scope-security). `hj` does not change those
account settings.

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

The package `name` in `deno.json` or `deno.jsonc` is authoritative. Adoption,
repair, and removal preserve a valid configured name, even when the GitHub
repository has another name. Change this configuration value first to rename a
package.

Without a configured name, `hj` derives the package component from the starting
directory. It lowercases the name, removes a leading `deno`, replaces
unsupported character runs with `-`, and trims edge hyphens. For example,
`deno Fancy_Tool` becomes `fancy-tool`. The scope, the part before `/`, comes
from an explicit `--jsr-scope=<scope>` or authenticated JSR memberships. The
result shows the resolved package name. If either component is invalid, set an
explicit scoped name in the Deno configuration.

To discover scopes, supply a JSR user token through the `JSR_TOKEN` environment
variable. Keep the token in your shell or secret manager. `hj` sends it only as
bearer authentication and never saves it in generated files or defaults.
[JSR user tokens](https://jsr.io/docs/api#authentication-tokens) can read
memberships; GitHub Actions OIDC tokens support publication only.

The [JSR management API](https://api.jsr.io/.well-known/openapi) returns actual
memberships from `GET /user/scopes`. Both ordinary members and admins qualify;
pending invitations do not. With one membership, `hj` selects that scope. With
several, a terminal prompt requires a scope name. In automation, supply
`--jsr-scope=<scope>`; `--yes` never selects among scopes. For example:

```bash
hj repo features --jsr-package --deno-lib --jsr-scope=my-team --yes
```

A configured package name or explicit scope needs no additional selection. If
`JSR_TOKEN` is supplied, setup validates that scope against the memberships.
Without a token, an explicit scope allows local configuration only and does not
prove publishing permission. A conflicting flag cannot rename a configured
package. Missing authentication during discovery, API failures, and unreadable
responses stop setup as unresolved. An empty membership list instead explains
that you need a JSR scope. Setup never creates scopes or infers them from a
local username or GitHub identity.

The [public JSR naming rules](https://jsr.io/docs/packages) permit 2–58
characters in package components and 2–20 in scopes. Both permit lowercase
letters, digits, and single hyphens between other characters. Local validation
does not establish registry availability or permission to publish. JSR also
applies registry policy when a package is created. Resolve a registry rejection
with an explicit name in the Deno configuration.

New package configuration starts at version `0.0.0`. It adds the publishing
check to the generated check aggregate. Custom aggregates do not change the
local package status. Removing managed tasks requires an exact match.

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
