# Validation reuse pilot

Issue [#97](https://github.com/hugojosefson/cli/issues/97) explores reuse of
test results between related changes. This pilot records input keys during the
normal suite. An input key is a digest of declared dependencies. Matching keys
show a possible reuse opportunity. Every required test still runs.

The existing complete four-runtime comparison and Deno coverage remain the
release requirements. The pilot does not install Nx, restore test results,
combine coverage from separate runs, or change publication. Issue #97 remains
open for the adoption decision.

## The first group

The `github-repository` group contains five existing test files:

- `src/repository/github-default-project_test.ts`
- `src/repository/github-project-area_test.ts`
- `src/repository/github-repository-setup_test.ts`
- `src/repository/local-github-client_test.ts`
- `src/repository/local-github-identity-reader_test.ts`

These files execute 56 test bodies. They exercise repository readers, project
planning, pagination, and failure handling through injected GitHub responses.
The audit found no real GitHub requests or reads of checkout files in these test
bodies. Their resolved imports, including type imports, do not reach the package
version. All other discovered tests belong to `remainder`. New test files enter
that group automatically.

The earlier audit found only small groups without package metadata dependencies.
The selected group included about 0.65 seconds of Deno test bodies in the old
coverage log. The slower terminal prompt tests also reach metadata through type
imports, so this pilot excludes them. The boundary gives a substantive
experiment with limited immediate time savings.

Two standalone runs per runtime gave these command durations. Each run executed
the same 56 bodies. Native compilation already existed and is excluded.

| Runtime | First run | Second run |
| ------- | --------: | ---------: |
| Deno    |   2.293 s |    1.189 s |
| Node 24 |   1.103 s |    1.087 s |
| Node 26 |   1.090 s |    1.085 s |
| Bun     |   0.777 s |    0.816 s |

These measurements describe this machine and warm local dependencies. They do
not predict hosted CI savings. The pilot records its own observation overhead
for comparison with the test durations.

## Input boundaries

Each complete successful suite adds an `observation` field to its existing
`.hj/test-results/<runtime>.json` report. Partial runs do not produce
observations. The full report still records every file and executed body. The
existing matrix comparison does not accept an observation as a substitute for a
runtime result.

The focused key includes these inputs:

- The five files and their local imports, including type imports and resolved
  dynamic imports, from frozen `deno info` results.
- The test recorder, runner, observation tools, lockfile, and toolchain file.
- The complete parsed `deno.json` configuration except `version`, plus its file
  permissions.
- The runtime version, host Deno version, operating system, architecture,
  coverage mode, and selected environment values.

The environment values include the runner's allowed test variables, color
controls, and locale values. The report stores a digest of those values.
Generated inventory paths and the source-root URL do not enter the focused key.
The audited group does not consume those bookkeeping values as test inputs. The
selected Deno version identifies the generated Deno executable setting.

The conservative key includes the contents and permissions of every tracked or
nonignored repository file. It includes package metadata, documentation,
workflow files, and native build tools. It also includes the runtime context and
complete test-file inventory. It excludes ignored generated outputs and Git
commit IDs. The runner captures inputs before and after each suite. The
comparison command rejects observations when the captures differ.

An imported `deno.json`, an external local import, an unresolved module, a
symlinked dependency, or a full-CLI fixture makes the focused key conservative.
The resolved import graph does not prove the absence of computed imports or
runtime file reads. Changes to the focused code require another manual audit of
those dependencies. These candidate keys cannot authorize future cached results
without further work on complete input declarations and result trust.

Native compilation still emits the complete CLI and test suite. For Node and
Bun, `executionKey` therefore retains the conservative key for both groups. A
version change can preserve the focused `candidateKey` while changing its native
`executionKey`. Independent native compilation remains future work.

## Collect and compare

Run the normal required suite, then save its reports outside the checkout:

```bash
deno task ci
mkdir -p /tmp/hj-validation-before
cp .hj/test-results/{deno,node24,node26,bun}.json /tmp/hj-validation-before/
```

After a real change, run `deno task ci` again in the same checkout. Keep the
runtime, coverage mode, and environment consistent when comparing source
changes. Keep files unchanged during each run. Compare each runtime separately:

```bash
deno task validation-compare /tmp/hj-validation-before/deno.json .hj/test-results/deno.json
deno task validation-compare /tmp/hj-validation-before/node24.json .hj/test-results/node24.json
deno task validation-compare /tmp/hj-validation-before/node26.json .hj/test-results/node26.json
deno task validation-compare /tmp/hj-validation-before/bun.json .hj/test-results/bun.json
```

The command reports candidate matches, current execution matches, changed input
names, and group durations. It refuses failed, partial, missing, or unstable
observations. It does not execute tests or change files.

`bodyMs` sums only top-level test bodies. Parent bodies already include their
nested tests. This sum excludes startup, module loading, compilation, coverage
processing, and artifact transfer. Concurrent bodies can overlap. Treat it as a
measure of tested work, not saved elapsed time. `suiteWallMs` records elapsed
time for all runtime test commands. `observationMs` records input capture and
report preparation time before file output.

If observation collection fails, the runner prints the error and retains the
normal test result. Its report contains `observationError`. The comparison then
refuses that report. Required test failures continue to fail validation.

Collect several feature changes and actual release changes before deciding on
larger groups or Nx adoption. Compare the potentially reusable work with input
capture, compilation, and transfer costs. The pilot itself saves no execution
time because all validation remains fresh.
