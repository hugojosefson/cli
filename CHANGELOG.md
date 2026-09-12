# Changelog

## 0.7.2

- docs(release): record verified npm publication
- docs(release): verify npm package-name installation

## 0.7.1

- fix(release): permit local npm publication commands

## 0.7.0

- fix(projects): synchronize areas through additive repair
- feat(github): create and link repositories during setup
- feat(github-ci): migrate legacy workflows
- feat(release): migrate legacy publication workflows and tasks
- feat(editorconfig): add independent editor defaults
- test(editorconfig): include feature in registry expectation
- chore(editorconfig): enable feature
- fix(editorconfig): preserve unowned empty files on removal
- feat(deno-lib): teach starter assertions
- feat(release): publish npm packages after release tags
- fix(release): preserve formatted npm workflow detection
- docs: record repository feature examples and validation
- test(release): guard npm enablement during legacy migration
- fix(help): describe GitHub repository creation
- fix(github): accept migrated CI for main protection

## 0.6.0

- fix(readme): attribute cumulative guide blocks to their features
- feat(readme): generate feature-owned package guides
- fix(readme): project complete file observations for feature planning
- feat(config): add non-secret global defaults
- docs(config): clarify default feature selection
- fix(readme): retain block ownership after formatting
- test(readme): verify package guide commits and require repository examples
- fix(readme): preserve unchanged formatted contribution blocks
- feat(readme): migrate legacy README sources
- chore: use final project checks during repository feature updates
- chore(git-ignore): enable feature
- chore(jsr-package): enable feature
- chore(github-ci): enable feature
- fix(readme): preserve custom Install sections during repository adoption
- chore(jsr-package): enable feature
- chore(github-ci): enable feature
- fix(features): preserve offline badges and ignore generated coverage during
  formatting
- test(install): expect generated coverage formatting exclusion
- chore(github-ci): enable feature

## 0.5.0

- feat(cli): run final project tasks before feature commits
- feat(git): defer separate feature commits until validation succeeds
- feat(deno): manage application lock defaults and explicit ownership
- fix(git): attribute precomposed config and retain managed ignored files
- fix(git): attribute initial README license sections to their feature
- fix(git): keep private indexes in the repository Git directory
- fix(features): integrate final tasks with shared config and lock commits
- feat(jsr): discover authenticated scope memberships
- test(features): isolate final tasks during fixture setup
- test(features): verify final checks and separate config commits together

## 0.4.0

- feat(package): resolve identity across generated content
- feat(deno-test): report fresh coverage after every test run
- feat: manage generated-file Git exclusions
- test(features): validate combined Todo changes and record issue workflow

## 0.3.0

- feat: add default GitHub projects

## 0.2.4

- chore: update dependencies
- fix(deps): retain supported fork-version release

## 0.2.3

- fix(features): preserve workflow pins and explain detected states

## 0.2.2

- fix(github): share concurrent feature reads without caching later checks

## 0.2.1

- chore: configure repository features
- fix(cli): explain the Git prerequisite before feature detection
- docs: record first publication and prepare registry workflows
- docs: confirm registry CI and update workflow references

## 0.2.0

- chore: init repo
- docs: readme
- feat: define repository feature contracts
- chore: add webstorm project config
- feat: resolve repository features
- docs: define planned feature behavior
- feat: plan exact artifact changes
- feat: add Git repository feature
- feat: read local repository state
- feat: apply guarded local change plans
- feat: add static README feature
- feat: run repository feature commands
- feat: repair drifted repository features
- feat: select repository features interactively
- feat: add Deno formatting feature
- feat: add Deno library feature
- feat: add Deno CLI feature
- fix: compose shared directory plans
- feat: add Deno server feature
- fix: check explicitly requested drift
- feat: add composable Deno task features
- feat: build generated README content
- feat: confirm warning-bearing feature plans
- feat: add generated README provider
- feat: add MIT license provider
- feat: add Apache license provider
- feat: add common license providers
- feat: link licenses from README files
- feat: add weak feature presets
- feat: manage GitHub repository settings
- feat: revise GitHub preset defaults
- feat: add public GitHub preset
- feat: add GitHub CI workflows
- feat: manage GitHub repository rulesets
- feat: add JSR package configuration
- feat: add JSR OIDC releases
- fix: emit formatter-compatible generated files
- fix: inspect large license templates safely
- feat: add release publishing and stabilize development workflows
- fix: align release protection with live GitHub behavior
- feat: prepare CLI package and verify local installation
- test: cover terminal input and release cleanup failures
- docs: prepare public README and centralize generated package references
- feat: make feature output and documentation easier to scan
- feat(cli): color feature rows and honor terminal conventions
- fix(features): recognize configured projects beyond starter templates
- feat(server): generate native serve and development tasks
- fix(git): commit feature files when initializing a repository
- fix(server): grant listener permission in the generated CLI launcher
- fix(cli): report local and GitHub changes independently
- fix(release): handle real GitHub Actions publication requirements
- fix(release): clean up source collisions before auto-merge
- docs: assess missing git-hj-init behavior
- docs(git-hj-init): update feature recommendations
- fix(release): detect draft and duplicate GitHub releases
- docs: prepare version 0.1.0 and record live release validation
- docs: plan first release through managed features
- docs(repo-features): document feature presets and GitHub options
- docs: clarify JSR scope security setup
- feat(jsr): default to member-triggered CI publication
- fix(jsr): publish automatically after release tag creation
- feat(release): support pinned GitHub CLI sources for first publication
- fix(workflows): keep CLI loading from changing project lockfiles
- ci: reuse coverage checks in managed CI
- chore: configure repository features
- fix(protection): accept exact pinned-source CI workflows
- chore: configure repository features
- docs: distinguish initial capabilities from published release versions
- fix(release): confirm delayed publications and accept safe retries
- fix(jsr): verify transformed modules through bound manifest provenance
- fix(github): avoid redundant identity lookups and explain rate limits
- fix(jsr): dispatch publication at the release tag when main advances
- docs: record public bootstrap validation and authorized release steps
- chore: configure repository features

## Initial capabilities

The initial release includes these capabilities.

| Area             | Included behavior                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Repository setup | Inspect, enable, disable, and repair declared features.                                                                    |
| Deno projects    | Generate CLI, library, and server projects with standard tasks.                                                            |
| Git              | Initialize repositories and commit the selected generated files.                                                           |
| Documentation    | Manage static or assembled README files and licenses.                                                                      |
| GitHub           | Configure existing repositories, CI, and protection for personal repositories.                                             |
| Releases         | Prepare release PRs, merge by rebase, create tags, and run separate publishers.                                            |
| JSR setup        | Select package and release features with `--jsr`; publish automatically through GitHub Actions after release tag creation. |
| First release    | Load a pinned public GitHub commit with `--workflow-cli`, then migrate generated workflows to JSR.                         |
| Terminal output  | Show structured results in tables with terminal-aware colors.                                                              |

Linux is the supported test platform. The package exposes a CLI, with no
supported library API.

Live GitHub release tests passed in disposable repositories. JSR publication and
installation from JSR are being validated through the first-release pipeline.
See the [validation record](docs/live-validation.md) for evidence and limits.
