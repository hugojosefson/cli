# Repository features

A feature is one part of repository configuration. Feature flags select changes
independently. Examples use `hj` as shorthand for the
[local CLI](../README.md#run-locally):

```bash
hj repo features --deno-lib --deno-cli --no-deno-server
```

Each feature can:

- Detect whether it is disabled, enabled, drifted, or ambiguous.
- Check whether enabling or disabling it is safe before making changes.
- Produce a reviewable plan for enabling or disabling it.
- Declare direct feature dependencies and provided or required capabilities.

Features do not store revisions. Detection examines the current repository
behavior and structure. A feature can replace an exact legacy generated file.

Calling `hj repo features` without feature flags reports status without changing
anything. `--interactive` or `-i` opens a feature checklist. Defaults apply only
when the caller passes `--defaults`. The built-in default selection is
`["git", "readme"]`, where `git` is a feature and `readme` is a capability. A
capability is a function that a feature provides. Global configuration of this
selection is [planned](planned.md). Selecting a capability selects its enabled
provider or its default provider. The resolver can also select a capability's
default provider when an explicitly enabled feature requires a capability that
no enabled feature provides.

A command changes only explicitly named features, `--defaults` selections,
direct dependencies, and capability providers needed to enable them. Disabling a
feature fails while enabled features depend on it. Dependent features must be
disabled explicitly. The CLI stores no installation reason and has no
`--auto-remove` mode.

Drift repair is explicit. `--repair` alone repairs every drifted feature.
Combined with positive feature flags, it repairs only those features. Repair may
restore exact-schema artifacts, including starter code and tests, but never
adopts an ambiguous implementation.

When Git is enabled, a successful local feature operation validates its plan,
stages only planned paths, and creates one Conventional Commit.

## Available features

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
- `deno-lib`: adds a Deno library. It requires `deno-fmt`.
- `deno-cli`: adds a Deno CLI. It requires `deno-fmt`.
- `deno-server`: adds a minimal `Deno.serve` server. It requires `deno-fmt` and
  integrates with `deno-cli` when both are enabled.
- `readme-static`: provides the `readme` capability with a writable root
  `README.md`.
- `readme-build`: provides the `readme` capability with generated README
  support. It requires `deno-fmt`.
- `license-*`: MIT, Apache-2.0, GPL, AGPL, ISC, BSD, MPL, Unlicense, and CC
  license providers. Exactly one provider can be enabled.
- `jsr-package`: adds JSR package identity and publishing checks. It requires
  `deno-fmt`, `github-repo`, at least one Deno export, `readme`, and `license`.
- `github-repo`: detects authenticated access to the checked-out GitHub
  repository. It does not create or delete repositories.
- `github-*` repository-setting features independently manage auto-merge,
  merged-branch deletion, merge strategies, wiki, issues, projects, discussions,
  branch updates, and web commit signoff.
- `github-ci`: adds pull-request checks plus nightly and manual dependency
  updates. It requires `github-repo`, `deno-fmt`, and the repository setting
  “Allow GitHub Actions to create and approve pull requests.” Pull-request runs
  created by its dependency workflow require approval from a user with write
  access.
- `github-main-protection`: requires `github-ci` and protects the default branch
  with pull requests, generated CI, resolved review threads, deletion blocking,
  and force-push blocking.
- `github-main-review`: layers one stale-dismissed, last-push approval on main.
  Repository admins can bypass this review layer only through a pull request.
- `github-protected-tags`: requires `github-repo` and manages layered tag
  protection. The [release guide](releases.md#normal-release) defines the tag
  patterns, administrator bypass, and CLI SemVer validation. Repository admins
  can bypass tag mutation.
- `github-protection`: weak preset that enables main protection and protected
  tags. It keeps an active main-review feature but does not select that feature.
- `deno-config-version`: provides a release version from one Deno configuration
  that contains an exact SemVer version.
- `github-release-publish-tag`: adds unattended release pull requests and
  lightweight SemVer tags. It cannot operate with `github-main-review`.
- `github-release-publish-jsr`: publishes the JSR package with OIDC after tag
  publication. It requires `jsr-package`.
- `github-release-publish-github`: makes a GitHub Release after tag publication.

For release workflow migration, configuration, retries, and removal, read the
[release guide](releases.md).

`--github` is a fixed preset of repository settings. Its values reflect the
author's preferences. It does not inspect the user's recent repositories. It
enables auto-merge, merged-branch deletion, squash merging, rebasing, issues,
projects, branch updates, and private visibility. It disables merge commits,
wiki, discussions, and web commit signoff. Explicit setting flags override the
preset regardless of argument order. Remote changes require `--yes` and use one
guarded GitHub API update. `--no-github` is invalid. `--no-github-repo` safely
blocks because repository deletion is unsupported. The `--github-public` overlay
makes the repository public when combined with `--github`, while an explicit
`--github-private` or `--no-github-private` flag still wins. More-specific
preset IDs override a selected prefix preset. Unrelated contradictory presets
fail as ambiguous. Merge-message enum settings remain unchanged.

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

Generated source paths and exports remain stable across combinations:

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
requires a complete license. Interactive selection defaults to MIT and does not
offer an unlicensed choice. Attribution resolves from GitHub identity, then Git
configuration, then a prompt. Setup fails if required attribution remains
unresolved.
