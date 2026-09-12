# Migrate a legacy README

`readme-build` recognizes the current `git-hj-init` README generator and its
exact task. It converts quoted installation and example includes to standalone
`@@include(path)` directives. It replaces the generator task with
`hj readme
build` and regenerates the root README.

To review the replacement, run:

```sh
hj repo features --readme-build --deno-fmt --repair
```

The confirmation message shows the old task, its replacement, and the README
before and after generation. If the result matches your intent, repeat the
command with `--yes`. The operation leaves all files unchanged until
confirmation.

The migration preserves edited Markdown, installation scripts, example code, and
existing `./example-usage` exports. The build reads the existing included files.
It also retains `readme/generate-readme.ts` and unrelated imports, but the new
README task does not run that generator.

Migration requires the recognized generator, its task, and regular source files.
A custom generator, unsupported quoted include, missing include, or unsafe path
blocks the operation. Resolve those conflicts explicitly before retrying. Custom
default tasks also require a separate decision. The supported legacy `default`
and `all` tasks can receive the normal Deno formatting repair.
