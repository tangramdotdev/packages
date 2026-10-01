# Testing std

The root `testModules` table assigns a default tier to each imported module.
The harness automatically discovers every exported `test*` function. A small
`testTiers` table overrides the default for tests with different dependencies.
Modules do not need their own registration tables.

Before selecting or running tests, the harness rejects invalid tiers and stale
overrides. `bun scripts/check_std_tests.ts` checks that every test module appears
once in the root table. Both this audit and the harness behavior tests run through
`bun run check`.

Tests are grouped by the dependencies they need:

| Tier | Dependencies |
| --- | --- |
| `bootstrap` | Prebuilt toolchains, without the default SDK or utilities. Includes Rust workspace unit and documentation tests. |
| `sdk` | The default native SDK or utilities. |
| `extended` | Additional toolchains or cross targets. |

Assign a test according to its most expensive supported platform. Tiers run in
order, with tests within a tier running concurrently. A failed tier reports all
of its failures and prevents later tiers from starting.

```sh
# Run bootstrap, then SDK, with the default build prerequisite.
bun run auto -t std

# Run the same test tiers directly.
tangram build ./packages/std#test

# List every registered test without running it.
tangram build ./packages/std#test -a list -a all

# Select a tier and optionally a module path prefix.
tangram build ./packages/std#test -a bootstrap
tangram build ./packages/std#test -a sdk -a command
tangram build ./packages/std#test -a extended -a wrap

# Run every tier on the current host.
tangram build ./packages/std#test -a all
```

Multiple tiers form a union, as do multiple path prefixes. Their intersection
selects each test once. Without a tier filter, bootstrap and SDK are selected.
Invalid filters and empty selections fail.

Automatic discovery replaces the old root action aliases and nested aggregate test
functions. Each displayed name is a package-relative `<path>#<export>`. Rerun it
using the full module path, for example:

```sh
tangram build ./packages/std/wrap.tg.ts#testRewrapWithoutDependencies
```

Tests that do not support the current host log their name and the reason before
returning. Report these skips separately from exercised tests. A successful
Darwin run does not establish Linux-host support.

Registration accounts for the existing test exports; it does not imply that
every existing test has complete assertions or that every toolchain works.
Extended tests remain opt-in, and compiler or runtime fixes can be reviewed
separately from changes to this test plan. Existing failures remain visible.
