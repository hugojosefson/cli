# hugojosefson-cli (`hj`)

`hj` is an opinionated CLI for configuring repositories and automating personal
development workflows. Its interaction model takes some cues from `gh`, but its
configuration and features are specific to my workflow.

The CLI will be implemented with Deno 2 and published as `@hugojosefson/cli`.
The repository currently contains API contracts; it does not yet contain an
executable implementation.

## Repository features

Repository setup is expressed as independent features rather than templates or
profiles:

```bash
hj repo features --deno-lib --deno-cli --no-deno-server
```

Each feature can:

- Detect whether it is disabled, enabled, drifted, or ambiguous.
- Check whether enabling or disabling it is safe before making changes.
- Produce a reviewable plan for enabling or disabling it.
- Declare direct feature dependencies and provided or required capabilities.

Features do not have migrations or stored revisions. Detection examines the
repository's current behavior and structure.

Calling `hj repo features` without feature flags reports status without changing
anything. `--interactive` or `-i` opens a feature checklist. Defaults apply only
when the caller passes `--defaults`. The global default selection is
configurable. Without configuration, it is `["git", "readme"]`, where `git` is a
feature and `readme` is a capability. Selecting a capability selects its enabled
provider or its default provider. The resolver may also select a capability's
default provider when an explicitly enabled feature requires a capability that
no enabled feature provides.

A command changes only explicitly named features, `--defaults` selections,
direct dependencies, and capability providers needed to enable them. Disabling a
feature fails while enabled features depend on it. Dependent features must be
disabled explicitly. The CLI stores no installation reason and has no
`--auto-remove` mode.

Drift repair is explicit. `--repair` alone repairs every drifted feature;
combined with positive feature flags, it repairs only those features. Repair may
restore exact-schema artifacts, including starter code and tests, but never
adopts an ambiguous implementation.

When Git is enabled, a successful local feature operation validates its plan,
stages only planned paths, and creates one Conventional Commit.

## Initial features

The first feature set includes:

- `git`: runs `git init` and creates an empty `chore: init repo` commit. It is
  part of the built-in `--defaults` selection and cannot be removed once commit
  history exists.
- `deno-fmt`: adds the minimal Deno configuration and tasks needed for
  `deno fmt`. It creates `deno.jsonc` when no Deno configuration exists.
- `deno-lint`: adds `lint`, which fixes lint locally and runs non-fixing lint in
  CI.
- `deno-typecheck`: adds `typecheck`.
- `deno-test`: adds `test`.
- `deno-lib`: adds a Deno library; it requires `deno-fmt`.
- `deno-cli`: adds a Deno CLI; it requires `deno-fmt`.
- `deno-server`: adds a minimal `Deno.serve` server; it requires `deno-fmt` and
  integrates with `deno-cli` when both are enabled.
- `readme-static`: provides the `readme` capability with a writable root
  `README.md`.
- `readme-build`: provides the `readme` capability with generated README
  support; it requires `deno-fmt`.
- `license-*`: MIT, Apache-2.0, GPL, AGPL, ISC, BSD, MPL, Unlicense, and CC
  license providers. Exactly one provider may be enabled.
- `jsr-package`: adds JSR package identity and publishing checks; it requires
  `deno-fmt`, `github-repo`, at least one Deno export, `readme`, and `license`.
- `github-repo`: detects authenticated access to the checked-out GitHub
  repository. It does not create or delete repositories.
- `github-*` repository-setting features independently manage auto-merge,
  merged-branch deletion, merge strategies, wiki, issues, projects, discussions,
  branch updates, and web commit signoff.
- `github-ci`: adds pull-request checks plus nightly and manual dependency
  updates; it requires `github-repo`, `deno-fmt`, and the repository setting
  “Allow GitHub Actions to create and approve pull requests.” Pull-request runs
  created by its dependency workflow require approval from a user with write
  access.
- `github-main-protection`: requires `github-ci` and protects the default branch
  with pull requests, generated CI, resolved review threads, deletion blocking,
  and force-push blocking.
- `github-main-review`: layers one stale-dismissed, last-push approval on main;
  repository admins may bypass this review layer only through a pull request.
- `github-protected-tags`: requires `github-repo` and protects all tags.
  Repository admins may bypass tag mutation.
- `github-protection`: weak preset enabling all three protection features.
- `jsr-release`: adds JSR OIDC publishing only. It requires an externally linked
  JSR package and repository, plus an exact unprefixed SemVer tag equal to the
  `deno.json` or `deno.jsonc` version.

`--github` is a weak preset initialized from the 20 latest non-archived,
non-fork, non-template repositories owned by the authenticated user, then
adjusted for explicit preferences. It enables auto-merge, merged-branch
deletion, squash merging, rebasing, issues, projects, branch updates, and
private visibility; it disables merge commits, wiki, discussions, and web commit
signoff. Explicit setting flags override the preset regardless of argument
order. Remote changes require `--yes` and use one guarded GitHub API update.
`--no-github` is invalid; `--no-github-repo` safely blocks because repository
deletion is unsupported. The `--github-public` overlay makes the repository
public when combined with `--github`, while an explicit `--github-private` or
`--no-github-private` flag still wins. More-specific preset IDs override a
selected prefix preset; unrelated contradictory presets fail as ambiguous.
Merge-message enum settings remain unchanged.

The `readme` capability has exclusive providers. Its default provider is
`readme-static`. Enabling `readme-build` while `readme-static` is enabled plans
an atomic replacement after showing the plan. It copies the writable root
`README.md` to the build source under `readme/`, then replaces the root file
with generated output. Switching back keeps the generated root content as a
writable static README and plans removal of `readme/`. If Git is enabled and
`readme/` is clean, removal needs no extra confirmation. Without Git, or when
`readme/` is dirty, the plan warns and requires confirmation. `--yes` accepts
the warning.

The Deno features can coexist. Git is not a dependency of Deno formatting,
library, CLI, server, or JSR package features. Features that need Git declare it
as a direct dependency. With no enabled features, `hj` creates nothing.

Deno source paths and exports remain stable across combinations:

- `deno-lib`: `src/lib/mod.ts`, exported as `.`.
- `deno-cli`: `src/cli/cli.ts`, exported as `./cli`.
- `deno-server`: `src/server/server.ts`, exported as `./server`.
- Tests live under `test/`.

When CLI and server coexist, the CLI owns a generated command registry and the
server contributes its `serve` command. Neither feature patches the other's
free-form source.

`jsr-package` derives its lowercase `@owner/repository` name from the linked
GitHub repository, starts at version `0.0.0`, and adds the command
`deno publish --dry-run --check=all` to `check`. A JSR package and GitHub
repository link remain external prerequisites for later OIDC publishing. It
requires a complete license; interactive selection defaults to MIT and does not
offer an unlicensed choice. Attribution resolves from GitHub identity, then Git
configuration, then a prompt. Setup fails if required attribution remains
unresolved.

## Shared commands

Large reusable implementations belong in `hj`, not generated repositories. The
README builder will be exposed as:

```bash
hj readme build
```

Generated tasks and workflows invoke an exact published `jsr:@hugojosefson/cli`
version. Project-specific formatting, checks, tests, workflow permissions, and
triggers remain declared in each repository. Stateful release orchestration
belongs in one `hj release` process.

Deno task objects use descriptions and dependencies. Independent checks may run
in parallel; ordered file mutations remain in a single command. `default`
regenerates and fixes files before checking. `check` is the normal validation
aggregate, and `all` adds publish dry-run when `jsr-package` is enabled. Lint
fixes locally, while CI runs a non-fixing lint check.

Generated GitHub workflows use `.github/workflows/hj-ci.yaml`,
`.github/workflows/hj-deps.yaml`, and `.github/workflows/hj-release.yaml`. CI
runs for pull requests only. Its minimum Deno version is globally configurable
and defaults to the current stable version when the feature is enabled.

## Configuration

Global non-secret defaults live under the XDG configuration directory. The
initial interface is:

```bash
hj config get <key>
hj config set <key> <value>
hj config list
hj config unset <key>
```

CLI flags override configured defaults. Missing values are asked interactively
on a TTY. Tokens, private keys, and other secrets are never configuration
values.

GitHub repository visibility is prompted when unresolved, with private selected
by default. Non-interactive creation requires a CLI or global configuration
value.

The repository default selection is a global list of feature or capability IDs.
Its built-in value is:

```json
["git", "readme"]
```

## Source

[`src/api/`](src/api/) contains the feature, detection, planning, artifact, and
read-only repository contracts. Runtime implementation will live elsewhere under
`src/`.

## Development

```bash
deno fmt
deno task all
```
