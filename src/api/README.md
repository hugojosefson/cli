# API contracts

This directory defines the feature API shared by command handling, planners, and
future runtime code. It contains declarations only. Runtime implementations
belong outside `api`.

`capability.ts` defines capabilities, provider policies, and defaults.
`feature-change.ts` records why the resolver selected each requested state.
Plans stay structured and secret-free, including guarded directory removal.
