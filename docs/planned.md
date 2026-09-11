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
version from `deno.json`. Version `0.1.0` is prepared locally with draft release
notes. The README is prepared for the first public JSR release; its registry
command becomes available after publication. The
[development guide](development.md) describes current local installation. The
[first-release checklist](development.md#first-public-release) tracks the
remaining preparation.

An npm publisher is planned. There is no npm feature, command, or workflow. Its
proposed trigger is the same tag-success event that starts the GitHub Release
publisher. Its authentication and build procedure remain separate from tag
publication.

## First-release bootstrap

The release features are implemented. Loading the unpublished CLI in its own
generated workflows is not implemented. Current templates always use the exact
JSR reference from the CLI package metadata.

Add supported bootstrap execution before the first public release. Keep the
existing release commands and their checks. The
[first-release plan](first-release.md) owns the setup order and required
external steps.

| Planned requirement | Required result                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| CLI source          | Load a reviewed, immutable CLI revision without requiring an existing JSR version.                         |
| Managed workflows   | Generate and detect the bootstrap form through features, including repair and removal.                     |
| Release behavior    | Reuse tag preparation, guarded application, and both existing publishers.                                  |
| JSR identity        | Keep the expected workflow path and event route so provenance verification still applies.                  |
| First version       | Review the version calculated from source history and the configured baseline before publication.          |
| Validation          | Repeat the first-release path in scratchpad without editing generated templates or copying a modified CLI. |
| Normal distribution | Switch to the released JSR reference through managed feature operations.                                   |

There is no bootstrap feature flag yet. The local-copy scratchpad fixture does
not supply this product capability. Hand-written workflows, manual tags, and
direct package uploads are not the planned replacement.

## Remaining live validation

Local tests use real temporary Git repositories with injected GitHub responses.
The [live validation record](live-validation.md) covers real GitHub workflow
runs in disposable repositories. These runs use a local copy of the unpublished
CLI in isolated Linux runners. The CLI source stays on the local machine.

The remaining checks need registry access and separate publication
authorization:

| Scenario                  | Required check                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------- |
| JSR account               | Confirm scope ownership and package access.                                           |
| JSR publication           | Link an authorized package, publish it, and compare module digests and provenance.    |
| Repeated JSR publication  | Accept identical content and reject a conflicting version.                            |
| Registry installation     | Install the released CLI in clean Linux, then run help and a local feature operation. |
| Registry workflow loading | Run the generated workflows with their exact published JSR reference.                 |

The local-copy runs prove the GitHub release path, but they do not prove JSR
credentials or registry distribution. Keep live publication checks outside local
CI. See the [first-release procedure](first-release.md) for the order.
