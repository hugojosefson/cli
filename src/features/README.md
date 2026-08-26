# Feature resolution

`validate-feature-registry.ts` checks declarations. `resolve-feature-changes.ts`
is the public pure resolver. `resolve-registry-changes.ts` selects dependencies
and capability providers. `order-feature-changes.ts` returns safe operation
order.

The resolver reads detection results. It does not write artifacts, track feature
history, migrate repositories, or remove orphaned dependencies.
