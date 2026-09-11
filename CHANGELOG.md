# Changelog

## 0.1.0

Prepared for the first public release. This version is not published yet.

| Area             | Included behavior                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Repository setup | Inspect, enable, disable, and repair declared features.                                            |
| Deno projects    | Generate CLI, library, and server projects with standard tasks.                                    |
| Git              | Initialize repositories and commit the selected generated files.                                   |
| Documentation    | Manage static or assembled README files and licenses.                                              |
| GitHub           | Configure existing repositories, CI, and protection for personal repositories.                     |
| Releases         | Prepare release PRs, merge by rebase, create tags, and run separate publishers.                    |
| JSR setup        | Select package and release features with `--jsr`; publish through member-triggered GitHub Actions. |
| Terminal output  | Show structured results in tables with terminal-aware colors.                                      |

Linux is the supported test platform. The package exposes a CLI, with no
supported library API. Global configuration and an npm publisher are planned.
GitHub repository creation is also planned.

Live GitHub release tests passed in disposable repositories. JSR publication and
installation from JSR still need validation after publication is authorized. See
the [validation record](docs/live-validation.md) for evidence and limits.
