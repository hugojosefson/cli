# hugojosefson-cli (`hj`)

`hj` configures repositories and automates personal development workflows. It
uses TypeScript and Deno. Features manage Git, Deno projects, documentation,
GitHub configuration, and releases.

This project is unpublished. You can run the CLI from this checkout. The package
name is `@hugojosefson/cli`. Generated workflows currently reference
`jsr:@hugojosefson/cli@0.0.0`. They need a published package before they can run
remotely.

## Run locally

Install Deno at the version in [toolchain.json](toolchain.json). Install Git for
repository operations. GitHub operations also need an authenticated `gh`
installation. The local command uses the installed tools. It does not install
them.

From this checkout, run:

```bash
deno task hj --help
deno task hj repo features --help
deno task hj repo features
```

The last command reports this repository's feature status without changes.
Feature changes act on the command's working directory. For work in another
directory, use the
[development guide](docs/development.md#run-against-another-repository).

## Install from this checkout

Run `deno task install-local` to install the `hj` command. Add the printed
binary directory to `PATH`. The command still loads source from this checkout,
so keep the checkout at the same path. After moving it, reinstall with
`deno task install-local --force`.

For an isolated installation, run
`deno task install-local --root /absolute/path/to/tools`. Remove that
installation with `deno uninstall --global --root /absolute/path/to/tools hj`. A
registry installation remains unavailable until the package is published.

## Documentation

Each guide owns one topic:

- [Repository features](docs/repository-features.md): Selection, dependencies,
  repair, and generated project files.
- [Development](docs/development.md): Local commands, tests, coverage, CI, and
  adding a feature.
- [Releases](docs/releases.md): Setup, release behavior, retries, removal, and
  design constraints.
- [Planned work](docs/planned.md): Unimplemented configuration and validation
  that needs a published repository.

Command help comes from [command-help.ts](src/cli/command-help.ts). Run
`deno task hj <command> --help` for the current usage.

## Validate changes

Run the same checks as CI:

```bash
deno task ci
```

This command checks formatting, types, lint, tests, coverage, and whitespace.
For formatting fixes, run `deno task fmt` first.

## License

[MIT](LICENSE), copyright 2026 Hugo Josefson.
