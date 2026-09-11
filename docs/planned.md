# Planned work

Items in this guide are not available features or completed validation. The
[feature guide](repository-features.md) describes the implemented behavior. This
project remains unpublished. The [`git-hj-init` assessment](git-hj-init.md)
assesses missing behavior that this plan does not already cover, with reasons
and proposed README additions.

## Global configuration

The planned configuration interface stores non-secret defaults under the XDG
configuration directory:

| Planned command               | Purpose             |
| ----------------------------- | ------------------- |
| `hj config get <key>`         | Read one default.   |
| `hj config set <key> <value>` | Set one default.    |
| `hj config list`              | List defaults.      |
| `hj config unset <key>`       | Remove one default. |

`hj` does not implement these commands yet. Secrets will not be configuration
values.

| Planned priority | Source              |
| ---------------- | ------------------- |
| 1                | Command flags       |
| 2                | Configured defaults |
| 3                | Interactive prompt  |

The planned configuration includes default features and the Deno version for
generated workflows. `hj` uses built-in feature defaults and the Deno version
from `toolchain.json` for generated workflows.

Prompting for unresolved repository visibility and creating GitHub repositories
are also planned. `hj` features manage an existing linked GitHub repository. The
`hj` GitHub preset has fixed values. It does not query recent repositories to
choose defaults.

## Package distribution and npm

The JSR package name is `@hugojosefson/cli`. Package metadata, the MIT license,
the executable export, and a local installation task are present. CI validates
the package with a dry run. Generated workflows read the package name and
version from `deno.json`. Version `0.0.0` is still the development placeholder.
The README is prepared for the first public JSR release; its registry command
becomes available after publication. The [development guide](development.md)
describes current local installation. The
[first-release checklist](development.md#first-public-release) tracks the
remaining preparation.

An npm publisher is planned. There is no npm feature, command, or workflow. Its
proposed trigger is the same tag-success event that starts the current
publishers. Its authentication and build procedure remain separate from tag
publication.

## Remaining live validation

Local tests use real temporary Git repositories with injected GitHub responses.
The [live validation record](live-validation.md) covers the separate scratchpad
checks completed without publishing this project. Full generated workflows and
publisher checks still need a published package. Run the remaining checks in a
disposable remote repository after package publication is authorized:

| Scenario                    | Required check                                               |
| --------------------------- | ------------------------------------------------------------ |
| Source PR merge             | Starts tag preparation.                                      |
| Release commit              | Has the expected tree.                                       |
| Tag creation                | Creates the lightweight tag and removes the owned branch.    |
| Success event               | Starts the independent publishers.                           |
| JSR publication             | Module digests and provenance match.                         |
| Repeated JSR publication    | Accepts the same version without conflicting changes.        |
| GitHub Release              | Fields match the prepared release data.                      |
| Repeated GitHub Release     | Reuses the matching release.                                 |
| Competing source merges     | Resolves the collision without overwriting unrelated work.   |
| Interrupted tag publication | Recovers the exact release.                                  |
| Publisher failure           | Retries safely.                                              |
| Feature removal             | Merge workflow removal before removing exact tag protection. |
| Cleanup                     | Remove temporary workflows and fixtures.                     |

A live test fixture must identify its owned resources and restrict its input
operations. The fixture must confirm the remote state after an expected
rejection. Keep publication and these live checks outside local CI.
