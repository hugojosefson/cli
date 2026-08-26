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

## Initial features

The first feature set includes:

- `git`: runs `git init` and creates an empty `chore: init repo` commit. It is
  part of the built-in `--defaults` selection and cannot be removed once commit
  history exists.
- `deno-fmt`: adds the minimal Deno configuration and tasks needed for
  `deno fmt`.
- `deno-lib`: adds a Deno library; it requires `deno-fmt`.
- `deno-cli`: adds a Deno CLI; it requires `deno-fmt`.
- `deno-server`: adds a minimal `Deno.serve` server; it requires `deno-fmt` and
  integrates with `deno-cli` when both are enabled.
- `readme-static`: provides the `readme` capability with a writable root
  `README.md`.
- `readme-build`: provides the `readme` capability with generated README
  support; it requires `deno-fmt`.

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
library, CLI, or server features. Features that need Git, such as publishing or
release, declare it as a direct dependency. With no enabled features, `hj`
creates nothing.

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
in parallel; ordered file mutations remain in a single command.

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
