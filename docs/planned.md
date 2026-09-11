# Planned work

Items in this guide are not available features or completed validation. The
[feature guide](repository-features.md) describes the implemented behavior. This
project remains unpublished.

## Global configuration

The planned configuration interface stores non-secret defaults under the XDG
configuration directory:

```text
hj config get <key>
hj config set <key> <value>
hj config list
hj config unset <key>
```

The CLI does not implement these commands yet. The planned precedence is command
flags, configured defaults, then an interactive prompt. Secrets will not be
configuration values. The planned configuration includes default features and
the Deno version for generated workflows. Current feature defaults are built in,
and generated workflows use the checked-in toolchain version.

Prompting for unresolved repository visibility and creating GitHub repositories
are also planned. Current features manage an existing linked GitHub repository.
The GitHub preset has fixed values. It does not query recent repositories to
choose defaults.

## Package distribution and npm

The JSR package name is `@hugojosefson/cli`. Package metadata, the MIT license,
the executable export, and a local installation task are present. CI validates
the package with a dry run. Generated workflows reference version `0.0.0` as a
development placeholder. Before those workflows run remotely, publish a usable
package and update their exact package references. Registry installation still
needs publication. The README describes local installation and the development
runner.

An npm publisher is planned. There is no npm feature, command, or workflow. Its
proposed trigger is the same tag-success event that starts the current
publishers. Its authentication and build procedure remain separate from tag
publication.

## Remaining live validation

Local tests use real temporary Git repositories with injected GitHub responses.
The [live validation record](live-validation.md) covers the separate scratchpad
checks completed without publishing this project. Full generated workflows and
publisher checks still need a published package. Run the remaining checks in a
disposable remote repository after package publication is authorized:

- Complete a source PR and confirm that its merge starts tag preparation.
- Confirm the release commit tree, lightweight tag, branch cleanup, and success
  event.
- Confirm JSR module digests, provenance, and a repeated publication of the same
  version.
- Confirm GitHub Release fields and a repeated publication of the same version.
- Exercise competing source merges, interrupted tag publication, and publisher
  retries.
- Remove publisher workflows, merge the removal, and then remove exact tag
  protection.
- Remove every temporary workflow and fixture after the test.

A live test fixture must identify its owned resources and restrict its input
operations. The fixture must confirm the remote state after an expected
rejection. Keep publication and these live checks outside local CI.
