# First public release

The first public release is `0.2.0`. The owner authorized publication on
2026-09-12. The generated pipeline published the CLI to GitHub and JSR without
manual version edits, release tags, or package uploads.

| Result           | Evidence                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| Public source    | [hugojosefson/cli](https://github.com/hugojosefson/cli)                               |
| Workflow setup   | [Source PR 1](https://github.com/hugojosefson/cli/pull/1), merged by rebase           |
| Release commit   | [Release PR 2](https://github.com/hugojosefson/cli/pull/2), merged by rebase          |
| Release tag      | [0.2.0](https://github.com/hugojosefson/cli/releases/tag/0.2.0)                       |
| Registry package | [@hugojosefson/cli@0.2.0](https://jsr.io/@hugojosefson/cli@0.2.0)                     |
| Live checks      | [Publication and installation results](live-validation.md#cli-publication-2026-09-12) |

## Bootstrap and migration

Generated workflows normally load a published CLI version from JSR. The first
release used the implemented
[bootstrap option](releases.md#bootstrap-before-the-first-registry-version),
which loads a full commit SHA from the public GitHub repository. Repository
configuration, protection, CI, and publication all used implemented features.

The initial `0.1.0` package version was a baseline. The release pipeline
selected `0.2.0` from the conventional commit history. It created the changelog
and version commit, merged by rebase, created the protected tag, and started
both publishers.

After registry installation passed, the
[registry migration command](releases.md#bootstrap-before-the-first-registry-version)
generated workflows that use the published CLI. This repository excludes only
`jsr:@hugojosefson/cli` from Deno's dependency age delay. Other dependencies
retain the 24-hour delay. This allows an immediate workflow migration after our
own release.

## Subsequent releases

Merge source changes into `main` to start the same automatic release pipeline.
Follow the [release guide](releases.md) for configuration, publication checks,
and retry commands. The JSR scope requires CI publication and permits the
release bot to publish from the linked repository.

Use the [README installation command](../README.md#install) to install from JSR.
No clone or download of this repository is required. For a release under 24
hours old, the README explains Deno's dependency age delay and the explicit
override.
