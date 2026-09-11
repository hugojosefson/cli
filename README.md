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

## Start here

Change to the directory you want to manage. Inspect its features:

```bash
hj repo features
```

This command reports the current state without changes. Choose changes
interactively:

```bash
hj repo features --interactive
```

For command help, run:

```bash
hj --help
```

Feature operations apply to the current directory. The
[feature guide](docs/repository-features.md) explains selection and
confirmation.

## Requirements

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

| Guide                                              | Topic                                                         |
| -------------------------------------------------- | ------------------------------------------------------------- |
| [Repository features](docs/repository-features.md) | Select, enable, disable, and repair features.                 |
| [Releases](docs/releases.md)                       | Configure release workflows and recover interrupted releases. |
| [Development](docs/development.md)                 | Run from source, install locally, test, and contribute.       |
| [Live validation](docs/live-validation.md)         | Read the scratchpad test results and their limits.            |
| [Planned work](docs/planned.md)                    | Track unimplemented features and remaining validation.        |

## License

[MIT](LICENSE), copyright 2026 Hugo Josefson.
