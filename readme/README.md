# hj

[![Simple English: attempted](https://img.shields.io/badge/simple_english-attempted-blue)](https://www.asd-ste100.org/)

`hj` configures repositories and automates personal development workflows.
Install it from [JSR](https://jsr.io/@hugojosefson/cli) and run it in the
repository you want to manage.

| Area          | What `hj` manages                                          |
| ------------- | ---------------------------------------------------------- |
| Projects      | Git repositories and Deno project files.                   |
| Documentation | README files and licenses.                                 |
| GitHub        | Repository settings, protection rules, and workflows.      |
| Releases      | Version changes, changelogs, tags, and package publishing. |

<!-- hj:readme jsr-package:badges d656b1327b62219112d1f9aae71fbd85e417c94f6e4f8de91520618d5a2e2ac2 -->

[![JSR Version](https://jsr.io/badges/{{package.name}})](https://jsr.io/{{package.name}})
[![JSR Score](https://jsr.io/badges/{{package.name}}/score)](https://jsr.io/{{package.name}})

<!-- /hj:readme -->

<!-- hj:readme github-release-publish-npm:badge c9cf2e0e859be880fd5a386c1654e2aa24b3764dd827580bd4ad4ac07b5dc1cf -->

[![npm Version](https://img.shields.io/npm/v/@hugojosefson/cli)](https://www.npmjs.com/package/@hugojosefson/cli)

<!-- /hj:readme -->

<!-- hj:readme github-ci:badge cef2c14f63758c9d69d92ef24b123236225fdf1984e0a9e31519646de6464d00 -->

[![CI](https://github.com/hugojosefson/cli/actions/workflows/hj-ci.yaml/badge.svg)](https://github.com/hugojosefson/cli/actions/workflows/hj-ci.yaml)

<!-- /hj:readme -->

## Install

Linux is the supported and tested platform. Install [Deno](https://deno.com/),
then install `hj` from JSR:

```bash
deno install --global --allow-all --name hj jsr:@hugojosefson/cli
```

No checkout or separate download of this repository is needed. Add the binary
directory printed by Deno to your `PATH` if needed. The command grants full Deno
permissions so `hj` can manage files and run external tools. See the
[Deno installation reference](https://docs.deno.com/runtime/reference/cli/install/)
for installation options.

Deno delays new dependencies for 24 hours by default. To install a release
immediately, add `--min-dep-age=0` to the command. This disables the age delay
for that installation.

## Start here

Change to the directory you want to manage. Inspect its features:

```bash
hj repo features
```

This command reports the current state without changes. Here are selected rows
from this repository:

@@include(generated/features.md)

Choose changes interactively:

```bash
hj repo features --interactive
```

Use built-in presets to select a group of features with one flag:

| Option                | What it selects                                                     |
| --------------------- | ------------------------------------------------------------------- |
| `--defaults`          | [Configured defaults](../docs/configuration.md), or Git and README. |
| `--github`            | Common GitHub repository settings, including private visibility.    |
| `--github-protection` | Default-branch protection and protected tags.                       |
| `--github-public`     | Public visibility, including when combined with `--github`.         |

Apply the default feature selection:

```bash
hj repo features --defaults
```

Apply common GitHub settings with public visibility, or add branch and tag
protection:

```bash
hj repo features --github --github-public --yes
hj repo features --github-protection --yes
```

Explicit feature flags override presets regardless of argument order. For
example, apply the GitHub preset but disable its issues feature:

```bash
hj repo features --github --no-github-issues --yes
```

For command help, run:

```bash
hj --help
hj repo features --help
```

Feature operations apply to the current directory. The
[feature guide](../docs/repository-features.md) explains selection and
confirmation.

## Update or remove

| Action                           | Command                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Update to the latest JSR release | `deno install --global --allow-all --reload --force --name hj jsr:@hugojosefson/cli` |
| Remove the installed command     | `deno uninstall --global hj`                                                         |

## Documentation

| Guide                                                                | Topic                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Repository features](../docs/repository-features.md)                | Select, enable, disable, and repair features.                 |
| [Changelog](../CHANGELOG.md)                                         | Read release notes and known limits.                          |
| [Releases](../docs/releases.md)                                      | Configure release workflows and recover interrupted releases. |
| [Development](../docs/development.md)                                | Run from source, install locally, test, and contribute.       |
| [Live validation](../docs/live-validation.md)                        | Read the scratchpad test results and their limits.            |
| [Issues](https://github.com/hugojosefson/cli/issues)                 | Track proposed changes, validation, and design decisions.     |
| [Project](https://github.com/users/hugojosefson/projects/10/views/2) | Browse work, ideas, priorities, and recorded decisions.       |

## License

[MIT](../LICENSE)
