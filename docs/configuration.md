# Global configuration

`hj config` stores non-secret defaults outside the repository. The file is
`$XDG_CONFIG_HOME/hj/config.json` when `XDG_CONFIG_HOME` is absolute. Otherwise,
`hj` uses `$HOME/.config/hj/config.json`. Reading defaults does not create the
file or its directories.

| Command                       | Effect                                              |
| ----------------------------- | --------------------------------------------------- |
| `hj config list`              | Print saved values as JSON.                         |
| `hj config get <key>`         | Print one saved value. Fail if the key is unset.    |
| `hj config set <key> <value>` | Save one value. Preserve the other values.          |
| `hj config unset <key>`       | Remove one value and restore its built-in fallback. |

The supported keys are `features`, `deno-version`, and `github-visibility`.
Unknown keys and invalid values fail without changing the file. `hj` does not
store tokens, passwords, or other secrets in this file. If the file contains
invalid JSON, repair the file before changing defaults.

## Feature selections

`features` takes a JSON array of feature or capability IDs. A capability is a
function supplied by a feature, such as `readme`. Use the IDs from
`hj repo features`, or capability names from the
[feature guide](repository-features.md). Do not include `--` prefixes, preset
names, or duplicate IDs.

```bash
hj config set features '["git","readme","deno-lib","deno-test"]'
hj config get features
hj repo features --defaults
hj repo features --defaults --no-deno-lib --deno-cli
hj config unset features
```

`--defaults` uses the saved list in place of the built-in Git and README
choices. An empty array selects no default features. Explicit feature flags
override default selections. Dependencies can still select additional features.
Without `--defaults`, explicit feature flags select only the requested changes
and their dependencies.

In interactive mode, saved selections take priority over the remaining checklist
choices. The checklist omits those selections and their alternative capability
providers. To override a saved selection, use explicit feature flags with
`--defaults`. Without saved selections, the checklist controls all feature
choices.

With no feature flags, `hj repo features` only reports the repository state. It
does not read or apply global defaults, even if the configuration file is
invalid.

## Workflow Deno version

`deno-version` takes an exact stable version, such as `2.9.6`. Version ranges
and `latest` are not supported. The value controls new CI, dependency update,
and release workflows. It does not install Deno or change the package release
version.

```bash
hj config set deno-version 2.9.6
hj repo features --github-ci --yes
hj repo features --github-ci --deno-version=2.9.5 --repair --yes
hj config unset deno-version
```

The `--deno-version` flag takes priority over the saved value. Use that flag
with an explicit positive workflow feature or `--jsr`. Without a saved value or
flag, new workflows use the version from `toolchain.json` in the installed `hj`
package. Existing exact workflows keep their recorded version when defaults
change. To change an existing workflow version, select its feature with
`--deno-version` and `--repair`. Other workflow changes still require explicit
repair.

## GitHub visibility

Set the default visibility for new GitHub repositories:

```bash
hj config set github-visibility private
hj repo features --github-repo --yes
```

`github-visibility` accepts `public` or `private`. Explicit visibility flags and
presets take precedence. The setting never changes an existing repository.
Without a flag or default, setup asks in a terminal and fails with input
instructions in automation. See
[repository creation](repository-features.md#create-a-github-repository).

Local project Deno requirements are separate from these defaults. See
[local Deno selection and caching](local-deno-runtime.md) for per-command
overrides, project pins, compatible ranges, and offline use.
