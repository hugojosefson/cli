# Planned work

Items in this guide are not available features or completed validation. The
[feature guide](repository-features.md) describes the implemented behavior. The
source and the CLI package are public. The
[`git-hj-init` assessment](git-hj-init.md) assesses missing behavior that this
plan does not already cover, with reasons and proposed README additions.

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

The CLI is published on JSR as `@hugojosefson/cli`. Follow the
[README](../README.md#install) to install it. The implemented release features
publish new versions after source merges. The [release guide](releases.md)
describes that pipeline.

An npm publisher is planned. There is no npm feature, command, or workflow. Its
proposed trigger is the same tag-success event that starts the GitHub Release
publisher. Its authentication and build procedure remain separate from tag
publication.

The implemented
[bootstrap option](releases.md#bootstrap-before-the-first-registry-version)
loads the CLI from a pinned public GitHub commit. The first release used that
option before registry loading was available.

## Remaining live validation

The [live validation record](live-validation.md) covers real GitHub
configuration, release workflows, JSR publication, provenance, and registry
installation on Linux. Local tests also use temporary Git repositories with
injected GitHub responses. Keep live publication checks outside normal local CI.

| Scenario                | Status or limit                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Conflicting JSR version | Local tests reject conflicting metadata and provenance. A conflicting public package version is not deliberately uploaded. |
| Other operating systems | Linux is the current test target. Windows and macOS live validation remain planned.                                        |
