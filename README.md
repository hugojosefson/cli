# hugojosefson-cli (`hj`)

`hj` configures repositories and automates personal development workflows. It
uses TypeScript and Deno. Features manage Git, Deno projects, documentation,
GitHub configuration, and releases.

This project is unpublished. You can run the CLI from this checkout. The
intended package name is `@hugojosefson/cli`. Generated workflows currently
reference `jsr:@hugojosefson/cli@0.0.0`. They need a published package before
they can run remotely.

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
