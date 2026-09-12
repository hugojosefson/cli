/** @module Download caches shared by managed CI and release workflows. */
import { workflowDenoVersion } from "./workflow-toolchain.ts";

// setup-deno adds OS, architecture and job; its fallback also shares across jobs.
// Package version metadata is deliberately excluded from dependency cache keys.
export const denoCacheInputs = `          cache: true
          cache-hash: deno-${workflowDenoVersion}-\${{ hashFiles('**/deno.lock', 'toolchain.json') }}
`;

// Frozen npm ci still validates the locks and installs with scripts disabled.
// Do not cache the build output or node_modules: test preparation clears them.
export const nativeNpmCacheStep = `      - name: Cache native test npm downloads
        if: hashFiles('scripts/test-build/dependencies/package-lock.json') != '' && hashFiles('scripts/test-build/tools/package-lock.json') != ''
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ~/.npm
          key: native-test-npm-\${{ runner.os }}-\${{ runner.arch }}-\${{ hashFiles('scripts/test-build/dependencies/package-lock.json', 'scripts/test-build/tools/package-lock.json', 'toolchain.json') }}
          restore-keys: |
            native-test-npm-\${{ runner.os }}-\${{ runner.arch }}-
`;
