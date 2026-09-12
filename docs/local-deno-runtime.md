# Deno for local project tasks

`hj` runs its own application natively. Help and ordinary `repo features`
inspection do not find, start, or download Deno. Commands that actually need
Deno, such as a project's `deno task default`, resolve it when the task starts.

## Choose the requirement

`hj` uses the first available requirement:

1. `--runtime-deno=<version/range>` for this invocation.
2. The project's `.deno-version` or `.hj/deno-runtime.json`.
3. A compatible stable range starting at the Deno version in this CLI's
   `toolchain.json`, with that recorded version as the download preference.

The project directory is the command's working directory. `hj` does not search
parent directories for a requirement. Run the command from your project root.
Release worktrees use their own checked-out project files. An explicit override
replaces the project requirement, including malformed lower-priority files.

The existing `--deno-version` option and `hj config` key `deno-version` still
select versions for generated workflows. They do not choose the runtime used by
this local invocation. There is no user-wide local runtime default.

For an exact project version, `.deno-version` contains one version:

```text
2.9.6
```

For a compatible range, use `.hj/deno-runtime.json` instead:

```json
{
  "range": ">=2.9.6 <3",
  "preferred": "2.9.6"
}
```

Do not create both files. Both must be regular files inside the project. Unknown
JSON properties, invalid ranges, and preferences outside the range are errors.

The accepted range and the download preference serve different purposes. The
range permits reuse of an already installed or cached version. The preference
names the exact npm package version to obtain if reuse is impossible. A range
without a preference can reuse existing versions, but fails with instructions if
it needs a download. `hj` never asks a registry for the latest matching version.

For example:

```sh
hj repo features --editorconfig --yes --runtime-deno=2.9.6
hj repo features --deno-fmt --yes --runtime-deno='2.10.x' \
  --runtime-deno-preferred=2.10.2
hj repo features --deno-fmt --yes --offline
```

An operation that does not need Deno still does not resolve it when these
options are present. Quote a range that contains spaces or shell operators.

## Accepted versions and ranges

| Request                       | Accepted versions                                       |
| ----------------------------- | ------------------------------------------------------- |
| `2.9.6`                       | Exactly 2.9.6.                                          |
| `2.10.0-rc.1`                 | Exactly that prerelease, if available.                  |
| `^2.9.6` or `>=2.9.6 <3`      | Stable versions from 2.9.6 up to, but excluding, 3.0.0. |
| `~2.9.6` or `>=2.9.6 <2.10.0` | Stable 2.9.x versions starting at 2.9.6.                |
| `2.10.x`                      | Stable 2.10.x versions.                                 |

Ranges must stay inside one positive major version. The supported explicit
bounds are `>=major.minor.patch <major.minor.patch`, with a major-only upper
bound also allowed. Unbounded ranges, OR expressions, build metadata, and
prerelease ranges are rejected. To choose a prerelease, use an exact pin.
Compatibility describes the version policy; it cannot guarantee that every
project works with every version in its range.

## Reuse and acquisition

Selection order is deterministic:

1. A suitable Deno runtime already hosting this invocation.
2. The first suitable executable named `deno` in `PATH` order.
3. The highest suitable version in the shared cache.
4. The recorded exact download preference.

Empty `PATH` entries are ignored. Existing installations are never replaced or
upgraded. `--offline` stops before the download step and gives a clear error
when no installed or cached version satisfies the requirement.

The cache is `$XDG_CACHE_HOME/hj`, or `~/.cache/hj` when XDG is unset. The XDG
path must be absolute. Entries live in
`deno/linux-x64-glibc/<version>/bin/deno`. Automatic acquisition supports Linux
x64 with glibc. Alpine/musl and ARM64 are outside the initial supported scope.

`hj` prints a short notice to stderr before downloading. Node and Deno hosts use
npm; a Bun host uses Bun. The package manager obtains the official exact `deno`
package and its platform dependency with install scripts disabled. `hj` copies
the platform executable into a private staging directory, checks its version,
records a checksum, and publishes the complete directory atomically. Concurrent
invocations can stage separately, but never expose a partial cache entry.
Repeated calls in one process share an in-progress installation unless they have
independent cancellation signals.

Cache entries must contain regular files with the recorded version, platform,
checksum and executable mode. A damaged matching entry produces an error that
names the directory to remove. It is not silently replaced. Cancellation cleans
up the active staging directory. An abruptly killed process can leave an unused
`.install-*` directory; it is never considered a cached version and can be
removed when no installation is running.

The selected executable's directory is prepended to `PATH` only for the child
process. Nested `deno` commands therefore use the same selected runtime. The
parent process and the user's shell remain unchanged.

## Deno permissions and workflows

The local development runner retains narrow subprocess grants for help and
inspection. Task-capable mutations and release commands receive run permission
for dynamically selected cache paths. These operations already run arbitrary
project tasks. Environment grants remain an explicit list.

A direct Deno invocation keeps the permissions its caller supplied. Local task
resolution needs project read access and `PATH` environment access. Acquisition
also needs the cache's environment, read/write permissions, and permission to
run the package manager and selected executable. `hj` does not broaden a direct
caller's permissions or turn off Deno's checks.

Generated release workflows retain their fixed setup-Deno version and restricted
run/cache permissions. New task-capable templates grant `PATH` access so nested
commands agree. If a project's requirement differs from the workflow's installed
runtime, align the workflow's Deno version with the project. Do not expect a
restricted publisher to obtain another runtime without the required permissions.
Existing workflows that lack these grants report repairable drift. Repair adds
the required grants while preserving recorded CLI and setup-Deno versions. The
npm publication template also grants `tar` to verify the packaged manifest.
