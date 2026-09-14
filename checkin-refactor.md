# Checkin refactor preparation

Prepared on `refactor/unrender-to-checkin` from local main `fc5e5d85`, with
`fix/preserve-artifact-handles` reviewed through `53e3b939`.

The Tangram pins remain at `49944570f7e131642525f7a7ff7ca513c35e559c`.
Builds and tests are intentionally deferred until the incoming Tangram commit
is available. Formatting and source/diff review are the only validation so far.

## Expected Tangram contract

- `tg::checkin` continues returning an artifact handle. Its `to_referent()`
  preserves the resolved node, containing root in `options.id`, relative path
  in `options.path`, location, and local/remote authorization tokens.
- Checking in store paths, including paths not yet materialized locally, is
  efficient and recovers available authorization on the server.
- The resolved handle is appropriate for file contents and dependency
  construction. Runtime templates can instead use the containing root and
  subpath to retain filenames and surrounding directory context.

`common/src/paths.rs` centralizes this boundary and is also included by tgrustc
from the std source tree already present in its source bundle. Revisit this
helper when the final client API lands. The current pin drops the context, so
successful compilation against that pin would not validate the intended behavior.

## Prepared changes

- tgld checks in store library paths, explicit library files, interpreter and
  preload paths, and files found during transitive library discovery. Local
  library directories still check in selected library files under their SONAMEs.
- Directory subpath lookup memoization remains, as clarified during this work.
  Handle interning, authorization caches, serialized directory walk locks,
  unrender resolvers, store-root discovery, and launching-wrapper metadata
  recovery are absent.
- tgcc and tgrustc share path resolution. Existing structured environment
  templates identify literal boundaries in rendered strings; checkin recovers
  the handles and verifies their identities. Stale shadow values fall back to
  the current string. Standalone store paths and named path-list variables are
  supported; unsupported embedded paths fail explicitly. Arbitrary shell flag
  strings require a matching structured template.
- Interpreter arguments travel in a TGON array of templates via
  `TGLD_INTERPRETER_ARGS_VALUE_PATH`. The file records artifact dependencies and
  contains no location or tokens in its bytes. tgld restores authorization from
  the checked-in argument file. `TGLD_INTERPRETER_ARGS`, when set explicitly,
  accepts a TGON array of templates and takes precedence; whitespace splitting
  is removed. Empty arguments and arguments containing spaces remain separate.
- tgrustc checks in build-script executables, removing the byte-copy workaround
  for the old checkin cache and retaining their runtime dependencies.
- Checkout and dependency construction preserve authorized handles. Manifest
  serialization strips location and tokens; reading a wrapper for rebuilding
  restores them from the checked-in file's dependencies. This includes tgstrip.

## Review of fix/preserve-artifact-handles

Retained/adapted: authorized checkout, handle propagation into library and
wrapper dependencies, manifest dependency collection (including loader
arguments), token-free serialization, restoration when reading/rebuilding a
wrapper, merging complementary dependency tokens, and using actual dependency
handles in the SDK's transitive-library assertion.

Omitted: the `References` cache, `unrender_with` resolvers, startup metadata
scanning, handle interning, tests of those recovery mechanisms, the old pins and
lockfile changes, and the additional tgrustc dependency on the full common crate.
The TypeScript manifest-reference merge keeps complementary tokens without
adding the older branch's handle-identity reuse change.

## After repinning

Confirm the checkin contract above, especially root/subpath context through
file/directory downcasts, symlinks, and local checkouts. Then build and run the
prepared common regression tests plus SDK linker/wrapper, tgstrip, tgcc, and
tgrustc coverage. Exercise all library optimization strategies, local SONAME
selection, absent local store checkouts, local/remote tokens, wrapper rewrapping,
structured interpreter arguments with spaces and embedded paths, PATH lists,
and shell overrides of typed environment values.

Measure repeated store-path checkins only after the server cache is available.

## Checkpoint handoff (2026-09-14)

This document is the persistent handoff for resuming after context compaction.
The user requested a local checkpoint commit of this preparation; no push was
requested.

Explicit decisions from the conversation:

- Do not update the Tangram pin or run builds/tests until the incoming commit
  is available. This checkpoint does not authorize testing against the old pin.
- An earlier message asked to remove all tgld memoization, but the user's later
  explicit clarification was: "Retain directory lookup memoization; remove
  handle/authz caches." Follow the later clarification.
- Unsupported strings with embedded store paths must fail explicitly instead
  of silently dropping dependencies.
- The assumed API is an artifact handle whose `to_referent()` retains full
  context, not a new checkin output return type. The user explicitly noted that
  this may need refinement once the final Tangram commit is visible.

Implementation entry points:

- `packages/std/packages/common/src/paths.rs`: checkin options, referent-to-root
  interpretation, runtime templates, authorized rendering, and environment
  path handling. `checkin_rendered_template` uses existing template literals
  and checks identities returned by checkin; it does not parse IDs from paths.
- `packages/std/packages/tgld/src/main.rs`: store/local library handling,
  directory lookup memoization, transitive discovery, and wrapper construction.
  Original store paths are retained across symlinks for checkin context.
- `packages/std/packages/common/src/manifest.rs`: dependency token preservation,
  token-free serialization, authorization restoration, and argument-file reads.
- `packages/std/sdk/proxy.tg.ts`: structured interpreter argument-file producer.
- `packages/rust/tgrustc/src/main.rs`: includes the shared paths module via a
  relative source path. `packages/rust/proxy.tg.ts` already bundles the std
  workspace, so no new Cargo dependency or lockfile update was needed.
- `packages/rust/tgrustc/src/outer.rs` and `runner.rs`, plus tgcc and tgstrip:
  consumers of the new path and authorization behavior.
- `common/src/manifest/tests.rs` and the tests in `common/src/paths.rs`: prepared
  regression coverage, not executed.

Validation completed: Rust formatting with the repository's rustfmt settings,
oxfmt on the changed TypeScript files, and `git diff --check`. Source searches
found no Rust unrender calls, ID-only handle reconstruction via `with_id`,
old `References`/`CachedDirectory` machinery, or store-root discovery helpers.
All Cargo manifests and lockfiles remain unchanged. No compiler, test suite,
Tangram build, runtime authorization check, or performance measurement was run.

Review priorities once the API is available: validate symlink identities and
root/subpath retention; check structured environment matching with repeated
literal delimiters and stale shadow values; verify argument-file dependencies
restore both local and remote tokens; and ensure build-script checkin preserves
the executable's dependency closure. These are pending validation, not claims
of tested behavior.

Unrelated files were already untracked before this work and must remain outside
the checkpoint: `Claude.md`, `cacert-2026-07-16.pem.sha256`, `client.log`,
`tangram-rust-pickup-2026-09-04.md`, `tangram-rust-test-failures.md`,
`wrap_deps_probe.tg.ts`, `wrapper-mapped-manifest-design.md`, and
`wrapper-mapped-manifest-review.md`.
