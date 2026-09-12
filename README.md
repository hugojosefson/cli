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

To assign new GitHub issues to the default project, run
`hj repo project-auto-add --yes` with a signed-in Firefox automation session.
See [project setup](docs/repository-features.md#default-github-project) for the
browser command and fallback behavior.

<!-- hj:readme jsr-package:badges 572aba0516320896bc967eb6a2ab6257682c791937319c42ee30c162ca6165bd -->

[![JSR Version](https://jsr.io/badges/@hugojosefson/cli)](https://jsr.io/@hugojosefson/cli)
[![JSR Score](https://jsr.io/badges/@hugojosefson/cli/score)](https://jsr.io/@hugojosefson/cli)

<!-- /hj:readme -->

<!-- hj:readme github-ci:badge cef2c14f63758c9d69d92ef24b123236225fdf1984e0a9e31519646de6464d00 -->

[![CI](https://github.com/hugojosefson/cli/actions/workflows/hj-ci.yaml/badge.svg)](https://github.com/hugojosefson/cli/actions/workflows/hj-ci.yaml)

<!-- /hj:readme -->

## Install

Install [Deno](https://deno.com/) first. Then install `hj` directly from JSR:

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
for that installation. Otherwise, wait until the release is 24 hours old.

## Start here

Install [Git](https://git-scm.com/) before using repository commands. Change to
the directory you want to manage. Inspect its features:

```bash
hj repo features
```

This command reports the current state without changes. Tables use color in
terminals. Set `NO_COLOR=1` for plain output. See the
[output guide](docs/repository-features.md#output) for color controls.

Choose changes interactively:

```bash
hj repo features --interactive
```

Use built-in presets to select a group of features with one flag:

| Option                | What it selects                                                  |
| --------------------- | ---------------------------------------------------------------- |
| `--defaults`          | [Configured defaults](docs/configuration.md), or Git and README. |
| `--github`            | Common GitHub repository settings, including private visibility. |
| `--github-protection` | Default-branch protection and protected tags.                    |
| `--github-public`     | Public visibility, including when combined with `--github`.      |

Apply the default feature selection:

```bash
hj repo features --defaults
```

For an existing linked GitHub repository, authenticate with `gh auth login`
before applying GitHub presets. Apply common GitHub settings with public
visibility, or add branch and tag protection:

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
[feature guide](docs/repository-features.md) explains selection and
confirmation.

## Requirements

Linux is the supported and tested platform.

Only Deno is needed to install `hj`. Install other tools when you need their
operations. `hj` uses installed tools and does not install them for you.

| Tool                                         | When it is needed                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| [Deno](https://deno.com/)                    | Install and run `hj`. The tested version is in [toolchain.json](toolchain.json). |
| [Git](https://git-scm.com/)                  | Read or change Git repositories.                                                 |
| [GitHub CLI (`gh`)](https://cli.github.com/) | Manage GitHub repositories. Authenticate with `gh auth login` first.             |

## Update or remove

| Action                           | Command                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Update to the latest JSR release | `deno install --global --allow-all --reload --force --name hj jsr:@hugojosefson/cli` |
| Remove the installed command     | `deno uninstall --global hj`                                                         |

## Documentation

| Guide                                                                | Topic                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Repository features](docs/repository-features.md)                   | Select, enable, disable, and repair features.                 |
| [Changelog](CHANGELOG.md)                                            | Read release notes and known limits.                          |
| [Releases](docs/releases.md)                                         | Configure release workflows and recover interrupted releases. |
| [Development](docs/development.md)                                   | Run from source, install locally, test, and contribute.       |
| [Live validation](docs/live-validation.md)                           | Read the scratchpad test results and their limits.            |
| [Issues](https://github.com/hugojosefson/cli/issues)                 | Track proposed changes, validation, and design decisions.     |
| [Project](https://github.com/users/hugojosefson/projects/10/views/2) | Browse work, ideas, priorities, and recorded decisions.       |

<!-- hj:readme jsr-package:api e05134ccb0223f2e7cfb1ae5ebd8629368456ea93bd38d01da9bdd6b6b841c54 -->

## API

See the API documentation on
[jsr.io/@hugojosefson/cli](https://jsr.io/@hugojosefson/cli).

<!-- /hj:readme -->

<!-- hj:readme jsr-package:installation c32082fae6d00768da50c3d05af8d794fc7766c2b6fed8d975eec1619a93347e -->

## Installation

Add the package as a dependency:

```sh
deno add jsr:@hugojosefson/cli
```

<!-- /hj:readme -->

## License

[MIT](./LICENSE)
