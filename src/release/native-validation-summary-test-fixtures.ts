export function nativeSummaryFixture(runtime = "node24") {
  return {
    runtime,
    cacheEligible: false,
    context: "a".repeat(64),
    groups: Object.fromEntries(
      ["github-repository", "release-core"].map((name) => [
        name,
        {
          key: "b".repeat(64),
          inputs: Object.fromEntries(
            ["configuration", "packages", "dependencies", "tools"].map((
              name,
            ) => [
              name,
              "c".repeat(64),
            ]),
          ),
        },
      ]),
    ),
    buildMs: 123.5,
    buildObservationMs: 45,
    observationMs: 0,
  };
}
