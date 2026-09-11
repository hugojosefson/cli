# Missing behavior from `git-hj-init`

This assessment identifies `git-hj-init` behavior that `hj` does not implement
and [planned.md](planned.md) does not already cover. The first section
recommends additions. The second section explains which remaining differences
are historical baggage rather than useful additions.

The comparison uses source inspection from 2026-09-11, with design decisions
updated on 2026-09-12. No setup or publication commands ran for this assessment.
Existing feature names identify owners for missing behavior, not requests to
implement those features again.

## Recommend bringing into `hj`

These additions express the opinionated project defaults of `hj` through
repository files, development tasks, and generated documentation. Extend an
existing feature when that feature already owns related behavior. Add a separate
feature only for an independently selectable capability.

### New features

The following generated files are missing from `hj`. `git-hj-init` supplies each
through its unconditional setup bundle. Expose them independently in `hj` so
projects can select what they need.

| Proposed feature | Missing behavior to add                                                                                                                       | Reason                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-ignore`     | Add `.*.swp` by default. Add `/coverage/` when tests collect coverage and `/node_modules/` when project configuration creates that directory. | Editor swap files are temporary output. Shared exclusions must match project behavior. Preserve unrelated entries and remove only unchanged owned entries. |
| `editorconfig`   | Create `.editorconfig` with the content below. Preserve custom sections and values. Require neither Git nor Deno.                             | Editors need common whitespace conventions across languages.                                                                                               |

Use this exact `git-hj-init` content as the `editorconfig` starter:

```ini
# EditorConfig: http://EditorConfig.org

root = true

[*]
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
indent_style = space
indent_size = 2
```

### Missing additions to existing features

These are gaps within existing feature responsibilities. The proposed work is
limited to the additions listed here. The README and migration details follow in
separate subsections.

| Existing owner                             | Missing behavior to add                                                                                                                        | Reason                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deno-test`                                | Add watch mode, collect coverage in every ordinary test run, and display the coverage report after each run.                                   | Tests must continually show which code they exercise. Coverage is a default, not a separate opt-in feature.                                            |
| `jsr-package`                              | Resolve the package name from Deno configuration or a normalized directory name. Discover valid scopes through JSR when no scope is specified. | Package setup can precede GitHub linking. Directory naming follows the preferences of `hj`, while scope selection needs actual membership data.        |
| `git` and shared Git commit handling       | Create an empty `chore: init repo` commit on fresh initialization. Commit each changed feature separately, including removals.                 | The empty commit provides a rebase base before real project content. Feature commits let users review, squash, split, or revert one feature at a time. |
| Shared feature execution                   | Run the final `deno task default` after any feature change or removal that affects the task or its inputs.                                     | Setup must finish with the same formatting, generation, and checks as ordinary development.                                                            |
| Shared Deno configuration                  | Default to `lock: false`; require `lock: true` for CLI and server projects or another explicit lockfile requirement.                           | Libraries avoid unnecessary lockfiles while applications retain reproducible dependency versions.                                                      |
| `deno-lib`                                 | Generate starter tests using `@std/assert` and named steps.                                                                                    | Starter code must show how to write tests, not only prove that an empty function can run.                                                              |
| `deno-cli` and README contributors         | Resolve names from `deno.json(c)` through shared package metadata.                                                                             | Renaming the package must update help and generated documentation without editing many literals.                                                       |
| README providers and contributing features | Add the missing badges, instructions, and local example specified below, with ownership tracking.                                              | Generated projects need documentation that explains their actual package, commands, and examples.                                                      |
| README and workflow owners                 | Recognize and migrate `git-hj-init` output as described below.                                                                                 | Existing generated files otherwise block adoption or leave duplicate workflows active.                                                                 |

### Initialization, feature commits, and final task execution

Create the empty `chore: init repo` commit before the first feature-content
commit. Resolve Git identity before initialization, and create the empty commit
only in a repository without commits. This gives ordinary rebases a base before
all project content, so users can squash or split the first content commit.

Create one commit per changed feature, not one commit per generated file or one
commit for the whole operation. Include feature enable, repair, and removal
changes. Skip features with no changes. Use feature IDs in commit subjects, such
as `chore(deno-test): enable feature` and
`chore(readme-build): disable feature`.

Keep separate changes when several features edit `deno.jsonc` or README content.
Attribute each feature's edits within shared files and generated output to that
feature. Include resulting formatting changes with the feature that caused them.
Do not include unrelated pre-existing staged or working-tree edits.

After all selected features finish processing, run `deno task default` once if
any change adds that task or affects its meaning or inputs. Include feature
removals, task dependencies, imports, source files, examples, README inputs,
configuration, lockfiles, and file modes. If input relevance is uncertain, run
`default` conservatively when the resulting project defines it.

Use the final task definition and final project state. If removal deletes
`default` itself, report that no final task remains rather than restoring or
running the removed definition. Read-only inspection and operations with no
relevant changes do not trigger the task.

Build the per-feature commit sequence after final task execution succeeds.
Capture each feature's edits during processing so shared files remain separable.
Assign task-generated changes to the responsible feature before committing. Make
sure that the final commit tree matches the validated project files.

If `default` fails, return its failure and leave changes visible for correction.
Do not report successful feature completion or create the pending content
commits. The initial empty commit can remain. Report task changes that cannot be
attributed to a feature rather than silently including unrelated files.

### Lockfiles, coverage, and starter tests

Manage the lockfile policy through shared Deno configuration under `deno-fmt`,
with requirements contributed by `deno-cli` and `deno-server`. A separate
`deno-lock` feature is unnecessary. A lockfile records resolved dependency
versions for reproducible application runs.

| Final project state                                                    | Managed `lock` value | Reason                                                                                                             |
| ---------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Library or other Deno project without a lockfile requirement           | `false`              | Avoid a lockfile unless the project has a reason to keep resolved versions.                                        |
| `deno-cli` or `deno-server` enabled, including alongside a library     | `true`               | Applications need reproducible dependency versions. Enabling either feature must flip the managed value to `true`. |
| Last CLI or server feature removed, with no other lockfile requirement | `false`              | Recompute the policy from remaining features instead of retaining a requirement that no longer applies.            |
| Another explicit project requirement for a lockfile                    | Enabled              | Preserve that reason when no CLI or server feature remains.                                                        |

Generate or update the enabled lockfile before checks that require it. Include
owned lockfile changes in the responsible feature commit. On transition to
`lock: false`, remove only a lockfile that `hj` owns. Preserve custom lockfile
paths and content until their ownership is resolved.

Extend `deno-test` so every ordinary test run collects coverage and displays a
fresh report. Use `deno test --parallel --trace-leaks --coverage=coverage` for
collection and `deno coverage coverage` for reporting. Use a runner that reports
available coverage after failed tests too, while preserving the test failure.
Clear or isolate earlier coverage data so the report describes the current run.

Keep a `coverage` task as a convenient alias for a fresh test-and-report run.
Add `dev`: `deno test --parallel --trace-leaks --watch`. Watch mode remains a
separate continuous task. The default aggregate and CI both call the same
ordinary test task, so both display coverage without an extra feature flag.

Extend the `deno-lib` starter test with `@std/assert` and named steps. These
assertions teach imports, test structure, and result assertions even while the
implementation is a placeholder. Add the dependency when creating the test, and
preserve customized tests during later feature operations.

Use this exact starter for `test/lib_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { placeholder } from "../src/lib/mod.ts";

Deno.test("placeholder", async (t) => {
  await t.step("should not throw", placeholder);

  await t.step("should return undefined", () => {
    assertEquals(placeholder(), undefined);
  });
});
```

### Package identity and rename support

Use the package `name` in `deno.json` or `deno.jsonc` whenever available. Keep
that value authoritative for generated CLI help, README content, badges,
installation commands, and example package imports. An explicit rename changes
that source value before dependent content is regenerated.

When no package name exists, derive the package component from the starting
directory. Lowercase it, remove a leading `deno`, replace runs of unsupported
characters with `-`, and trim edge hyphens. For example, `deno Fancy_Tool`
becomes `fancy-tool`. Show the resolved name in the plan. Do not re-normalize an
existing valid package name during unrelated operations.

Make sure that the result satisfies JSR package-name rules. If normalization
produces an empty, reserved, or otherwise invalid name, require explicit input.
A syntactically valid name does not establish registry availability.
[JSR package naming](https://jsr.io/docs/packages) describes the public naming
constraints.

Add one shared metadata reader for JSON and JSONC. Use it for package-name
resolution in generated code and README generation. Generated CLI help must use
the configured package name, with the command name derived from its package
component unless explicitly overridden.

Resolve metadata relative to the project or installed module, not the caller's
working directory. Where runtime configuration access is unavailable, generate
bundled metadata from Deno configuration during the build. A rename must not
require hand-editing duplicate string literals across generated code.

Retain package-name references in the README source and resolve them on each
build. Regenerate owned installation examples from the same metadata. After
changing only the configured package name and regenerating, CLI help, badges,
API links, installation instructions, and published-example commands must agree.
Preserve custom text that does not belong to a managed contribution.

### JSR scope discovery

Extend `jsr-package` with authenticated scope discovery when no scope is already
specified by package configuration or explicit input. A scope groups packages
under a shared JSR name. Do not derive it from the local username or assume that
a GitHub login identifies a JSR scope.

JSR exposes `GET https://api.jsr.io/user/scopes`, which returns scope objects
for the authenticated user's memberships. Each object supplies a `scope` name.
JSR also exposes `GET /user/member/{scope}` for membership details. These
endpoints appear in the
[JSR management API specification](https://api.jsr.io/.well-known/openapi).

Use JSR user authentication for discovery. JSR documents bearer authentication
with user tokens. GitHub Actions OIDC tokens only support package publication.
Keep credentials outside generated files and non-secret defaults.
[JSR API authentication](https://jsr.io/docs/api#authentication-tokens)
describes the available token types.

| Discovery result                                                    | Required behavior                                                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One available scope and no explicit scope                           | Select that scope and show the resolved package name.                                                                                                                                      |
| More than one available scope and no explicit scope                 | Require the user to specify one. In an interactive session, require a selection. In automation, fail with the available names and the explicit scope input. `--yes` must not pick a scope. |
| A scope already supplied by package configuration or explicit input | Treat that as the user's selection. Validate membership when performing authenticated setup, without asking again merely because other scopes exist.                                       |
| No scopes                                                           | Explain that a JSR scope is needed. Do not invent a scope or create one implicitly.                                                                                                        |
| Missing authentication, API failure, or unreadable response         | Report unresolved discovery. Do not treat failure as an empty list or fall back to a username.                                                                                             |

Use actual memberships, not pending invitations. Both scope members and admins
can create and publish packages, so discovery must not filter out ordinary
members. These permissions are described in
[JSR scope roles](https://jsr.io/docs/scopes#roles).

### Exact README additions

The missing contributions below belong to their related features. A contribution
is content managed by one feature. Keep the existing project heading,
introduction, and license section.

| Missing contribution                                                                                                         | Owner                                                 | Reason                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| JSR version and score badges, API link, and an included installation example                                                 | `jsr-package`                                         | The version identifies the package release. The score badge promotes JSR and matches the expected style of JSR packages generated by `hj`. |
| CI badge for `hj-ci.yaml`                                                                                                    | `github-ci`                                           | Readers need the status of the workflow that runs project checks. CI means automated project checks.                                       |
| Deno requirement text                                                                                                        | Deno features through the active README provider      | Readers need an accurate runtime requirement in the generated documentation.                                                               |
| Command installation using the `./cli` export                                                                                | `deno-cli` with `jsr-package`                         | Command users need instructions that match the actual export.                                                                              |
| `readme/example-usage.ts`, its README include, `./example-usage` export, registry run command, visible result, and test link | `deno-lib` with `jsr-package` and the README provider | Potential users can run the example without a checkout. Separate files teach runnable examples and Markdown includes.                      |

Use shared contribution handling for `readme-static` and `readme-build`. For
`readme-static`, update root `README.md`. For `readme-build`, update
`readme/README.md` and regenerate root `README.md` with `hj readme build`. Track
ownership of each block to prevent duplicates and preserve custom content.
Remove only unchanged blocks owned by a disabled feature.

The following exact additions assume `jsr-package`, `deno-lib`, `deno-cli`,
`github-ci`, and `readme-build` are selected. Each feature contributes only its
own missing blocks. Insert badges after the existing introduction and sections
before the existing license section.

| Parameter                 | Source                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `{project}`               | Command name derived from the configured package name, unless explicitly overridden. |
| `{scope}` and `{package}` | Validated Deno package identity, without the leading `@`.                            |
| `{owner}` and `{repo}`    | Linked GitHub repository identity.                                                   |

````markdown
[![JSR Version](https://jsr.io/badges/@{scope}/{package})](https://jsr.io/@{scope}/{package})
[![JSR Score](https://jsr.io/badges/@{scope}/{package}/score)](https://jsr.io/@{scope}/{package})
[![CI](https://github.com/{owner}/{repo}/actions/workflows/hj-ci.yaml/badge.svg)](https://github.com/{owner}/{repo}/actions/workflows/hj-ci.yaml)

## Requirements

Requires [Deno](https://deno.com/).

## API

See the API documentation on
[jsr.io/@{scope}/{package}](https://jsr.io/@{scope}/{package}).

## Installation

Add the package as a dependency:

```sh
@@include(./install.sh)
```

To install the command:

```sh
deno install --global --name {project} jsr:@{scope}/{package}/cli
```

## Example usage

```typescript
@@include(./example-usage.ts)
```

Run this example without cloning the repository:

```sh
deno run --reload jsr:@{scope}/{package}/example-usage
```

From a checkout, run the same example:

```sh
deno run readme/example-usage.ts
```

For more examples, see the tests:

[test/lib_test.ts](../test/lib_test.ts)
````

The parameters above come from the shared package metadata on each generation.
The package scope and package component come from Deno configuration, not cached
copies in the template. The GitHub owner and repository remain separate values.

Use this exact generated `readme/install.sh` starter:

```bash
#!/usr/bin/env bash
deno add jsr:@{scope}/{package}
```

Keep installation commands in a separate file so editors parse them as shell
code. The file can grow beyond one `deno add` command. `readme-build` includes
the file without its shebang and uses standalone include directives. Refresh
owned package-name references when regenerating after a rename.

For the generated `deno-lib` starter, use this exact `readme/example-usage.ts`:

```typescript
import { placeholder } from "../src/lib/mod.ts";

const result = placeholder();
console.dir({ result });
```

`console.dir({ result })` belongs to the README example, not the generated
command entry point. It shows how the imported function produces the displayed
result, even while the function returns `undefined`. Preserve customized
examples and derive imports from the actual library export.

Add this export through `jsr-package`, and include the example in the published
package:

```json
{
  "./example-usage": "./readme/example-usage.ts"
}
```

Make sure that the registry run command works from outside a checkout and prints
the result. Preserve the export once users customize the public example.

`readme-build` rewrites the example import to `@{scope}/{package}` when the
library target matches the `.` export. For `readme-static`, insert that package
import and the example body directly instead of an include directive. Likewise,
insert installation file content without its shebang. For `readme-static`, use
`./test/lib_test.ts` as the test link target. The local example file keeps its
relative import so a checkout can run it.

Omit command installation without a `./cli` export. Omit library examples for
command-only packages, and omit GitHub badges without a linked repository.
Include a minimum Deno version only when the project explicitly establishes one.
Derive installation permissions from the generated command's actual needs.

### Migration gaps

Migration for `git-hj-init` output remains missing even where `hj` already
implements the destination capability. Recognize generated content and preserve
later project edits. Recommendations against new defaults do not authorize
removal of existing user-maintained files or public exports.

| Existing owner                     | Missing migration behavior                                                                                                                                                      | Reason                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `readme-build`                     | Recognize `git-hj-init` output in an existing `readme/` directory.                                                                                                              | An unowned directory currently blocks adoption.                                                                            |
| `readme-build`                     | Convert recognized `"@@include(./install.sh)";` and `"@@include(./example-usage.ts)";` lines to standalone `@@include(path)` directives. Replace the recognized generator task. | `hj readme build` does not interpret the quoted directive syntax from `git-hj-init`.                                       |
| README providers and `jsr-package` | Preserve edited examples, installation instructions, and existing `./example-usage` exports. Show generated content replacements in the plan.                                   | New defaults must not silently overwrite project work or remove public entry points.                                       |
| `github-ci`                        | Recognize and replace `deno.yaml` and `bump-deps.yaml` from `git-hj-init`.                                                                                                      | Parallel CI and dependency-update workflows create duplicate work.                                                         |
| Release features                   | Recognize `release.yaml` and related `release:*`, `version`, and `git-is-clean` tasks from `git-hj-init`. Migrate them together.                                                | Two release systems must not publish concurrently. Recognition of an earlier `hj-release.yaml` does not cover these files. |

Add migration cases for edited sources, quoted directives, and workflow
collisions. Compare README output before and after migration so the plan can
show meaningful changes. Keep required check names consistent with branch
protection throughout migration.

The affected `hj` implementation lives in
[readme-build-checks.ts](../src/features/readme-build-checks.ts),
[build-readme.ts](../src/readme/build-readme.ts), and
[github-ci-artifacts.ts](../src/features/github-ci-artifacts.ts).

## Recommend not bringing into `hj`

The following differences are also absent from `hj`, but do not justify new
features or defaults. These decisions concern potential additions, not removal
of behavior that `hj` already implements. Preserve custom project content during
any migration.

### Git habits and setup side effects

`git-hj-init` includes personal Git habits and automatic work during setup.
These behaviors do not establish independent repository capabilities. Keep the
missing additions in the first section focused on the requested project changes.

| Missing `git-hj-init` behavior to leave out                             | Reason                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A positional email override that appends local `user.email`             | Git already provides local, global, and conditional identity configuration. A second identity interface in `hj` creates competing sources. |
| A local `init` branch for rebases before the first push                 | A personal rebase bookmark adds a permanent name that users must understand.                                                               |
| Formatting every new file and accepting `error: No target files found.` | Parsing formatter errors adds no user capability. Generated templates can already have correct formatting.                                 |
| Running `@molt/cli --commit --prefix="chore: "` after each new file     | Adding a README or license must not update unrelated dependencies or create dependency commits.                                            |
| Committing each generated file separately                               | Use one commit per feature instead. Files shared by several features need separate attributable edits.                                     |
| Resetting README-source and license commits as reminders                | Git history is not a reminder interface.                                                                                                   |
| Displaying all tracked files and the root README through `bat`          | Full-file display adds output and a tool dependency without improving the feature result.                                                  |

### Additional defaults and README content

These differences add broad file exclusions or duplicate installation and
generation paths. Keep only the useful subset of a generated file or example.
The exact `.gitignore` exclusions and README omissions below explain that
boundary.

| Missing behavior to leave out                                                           | Reason                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blanket `/.vscode/`, `/.idea/`, and `/*.log` exclusions                                 | These patterns can hide intentionally shared files. The recommended `.*.swp` exclusion covers temporary editor output without excluding complete editor directories. |
| Source archive installation through `/tarball/main` and `tar -xzv --strip-components=1` | Downloading source neither installs a command nor adds a dependency.                                                                                                 |
| A copied `readme/generate-readme.ts` and its `@std/path` dependency in every project    | Adding another generator implementation creates maintenance work without a new capability.                                                                           |

### Workflow and naming differences

Exact workflow timing and implementation choices from `git-hj-init` are not
compatibility requirements. Unused helpers do not establish additional needs.
These differences do not require additional feature switches.

| Missing behavior to leave out                                                                         | Reason                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate default CI runs on PRs and non-`main` pushes                                                | PR checks already cover changes before merge. A separate trigger requires a concrete need to check branches before a PR exists. |
| Reproducing `hasundue/molt-action` and the `0 0 * * *` schedule exactly                               | Midnight and Molt are historical choices, not missing update capabilities.                                                      |
| A release workflow that directly pushes `main` and publishes packages                                 | A second publication path can compete with the coordinated release flow.                                                        |
| Project-local `git-is-clean`, `version`, `release`, and `release:*` aliases copied from `git-hj-init` | These tasks duplicate release responsibilities and can leave a second publication path active.                                  |
| Fetching latest Deno, GitHub Action major tags, or npm `fork-version` during every setup              | Moving defaults undermine repeatable generation.                                                                                |
| Inferring JSR ownership from `id -un`                                                                 | A local username does not establish ownership of a JSR scope.                                                                   |
| `get_latest_jsr_version` and `get_latest_deno_land_x_version`                                         | `git-hj-init` does not call either helper. Unused code establishes no user requirement.                                         |
