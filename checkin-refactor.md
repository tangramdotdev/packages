# Checkin refactor preparation

Prepared on `refactor/unrender-to-checkin` from local main `fc5e5d85`, with
`fix/preserve-artifact-handles` reviewed through `53e3b939`.

The Tangram pins remain at `49944570f7e131642525f7a7ff7ca513c35e559c`.
Builds and tests remain deferred until repinning is authorized. Formatting and
source/diff review are the only validation so far. PR 1132 is now available for
review, but the user explicitly asked not to repin yet.

## Tangram contract reviewed in PR 1132

- Reviewed [Tangram PR 1132](https://github.com/tangramdotdev/tangram/pull/1132)
  at `72729dd32b7458ea15259e366df5b8af1d137363` on 2026-09-14. The user authorized
  adapting the preparatory code after review, with no repin or builds/tests.
- `tg::checkin` and `checkin_with_handle` return `tg::checkin::Output`, whose
  `artifact` field is a `tg::Referent<tg::artifact::Id>`. This supersedes the
  earlier assumption that the helper would still return an artifact handle.
- The output referent preserves the resolved node and, for store subpaths, the
  containing root in `options.id` and relative path in `options.path`. Artifact
  handles still retain only identity, location, and tokens; `with_referent`
  followed by `to_referent` loses root/subpath context. Read that context before
  converting to a handle.
- When signing is enabled, the returned proofs authorize the resolved artifact
  and its containing root. These are two artifact-specific local subtree tokens,
  not necessarily one local and one remote token. The root itself needs one
  token and has no `options.id/path`. Preserve the entire token collection.
- Checkin canonicalizes the parent on the server before recognizing store and
  physical checkout paths. Intermediate symlinks can change the containing
  root; final symlinks within a root resolve to a node while keeping the final
  subpath. Client code must consume the returned context without reconstructing
  it from the original string.
- The server recovers proofs from checkout xattrs and verified origin-sandbox
  tokens, including without VFS, and retains returned tokens in sandbox state.
  Token expiration is bounded by the accepted proof. This supports removing
  client handle/authz caches; it is not evidence of measured performance here.
- Missing physical checkouts are supported through a mounted VFS store. Parent
  canonicalization still requires a resolvable filesystem parent; arbitrary
  nonexistent physical paths are not promised to work. The PR author reports
  that VFS runtime coverage was skipped on their machine.
- Resolved handles remain appropriate for file contents and dependencies.
  Runtime templates use the containing root and subpath to retain filenames
  and surrounding directory context.

`packages/std/packages/common/src/paths.rs` centralizes this boundary within std.
`packages/rust/tgrustc/src/paths.rs` contains an independent copy for tgrustc;
the packages must build as isolated units without depending on their relative
locations or each other's Rust source trees. Both copies now target PR 1132's
output API. The current pin still returns a handle, so this branch deliberately
awaits repinning before compilation and runtime validation.

## Prepared changes

- tgld checks in store library paths, explicit library files, interpreter and
  preload paths, and files found during transitive library discovery. Local
  library directories still check in selected library files under their SONAMEs.
- Directory subpath lookup memoization remains, as clarified during this work.
  Handle interning, authorization caches, serialized directory walk locks,
  unrender resolvers, store-root discovery, and launching-wrapper metadata
  recovery are absent.
- tgcc and tgrustc use equivalent, package-local path resolution. Existing
  structured environment templates identify literal boundaries in rendered
  strings; checkin recovers the handles and verifies their identities. Matching
  components retain the returned root/subpath. Stale shadow values fall back to
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
file/directory downcasts, symlinks, and local checkouts. Build the Rust crates
from their own package source bundles to verify isolation. Then run the
prepared common regression tests plus SDK linker/wrapper, tgstrip, tgcc, and
tgrustc coverage. Exercise all library optimization strategies, local SONAME
selection, absent local store checkouts, local/remote tokens, wrapper rewrapping,
structured interpreter arguments with spaces and embedded paths, PATH lists,
and shell overrides of typed environment values.

Measure repeated store-path checkins only after the server cache is available.

## PR 1132 adaptation (2026-09-14)

The source review found and corrected the return-type mismatch at every Rust
checkin call site. Both path helpers and tgrustc's existing `outer::checkin`
return the full output. Artifact-only consumers construct authorized handles
from `output.artifact`; tgld library directories, runtime templates, structured
environment reconstruction, and the tgrustc runner consume the referent context
directly. No context-dependent caller round-trips through an artifact handle.

`checkin_path` is only a convenience for repeated options and making paths
absolute. It adds no caching or authorization behavior to `tg::checkin`.
Referent-to-root/template interpretation is separate from that convenience.

The path classifiers now recognize the standard physical `checkouts` paths as
well as `store` paths. Without this, a raw environment checkout path could be
forwarded as a string or a library checkout directory treated as a local source
directory. Classification does not parse artifact IDs. Custom server directory
names still require structured values or callers that already identify and
check in a complete path; arbitrary embedded strings are not a supported input
format. Revisit that boundary separately if custom server roots need broader
raw-string support.

The existing path tests now model both resolved-node and root tokens at the
same local location, while also retaining a remote proof. A prepared regression
asserts that a checkin output becomes a root/subpath template with both proofs;
the unsupported-embedded-path test also covers physical checkout paths. These
tests have not run.

Still necessary from the original preparation: selective local library checkin
and SONAME naming, directory lookup memoization, authorized checkout/dependency
construction, manifest token stripping/restoration, and structured interpreter
arguments. PR 1132 does not replace these responsibilities. The old build-script
byte-copy workaround remains removed: direct checkin preserves dependencies;
the upstream in-flight checkin task map removes finished tasks. Local build-script
checkin performance remains a post-repin validation item, since the new store
fast path does not apply to ordinary local files.

Review source anchors at the reviewed head:

- [Checkin output API](https://github.com/tangramdotdev/tangram/blob/72729dd32b7458ea15259e366df5b8af1d137363/packages/clients/rust/src/checkin.rs#L108)
- [Handle conversion semantics](https://github.com/tangramdotdev/tangram/blob/72729dd32b7458ea15259e366df5b8af1d137363/packages/clients/rust/src/directory/handle.rs#L25)
- [Store checkin and token recovery](https://github.com/tangramdotdev/tangram/blob/72729dd32b7458ea15259e366df5b8af1d137363/packages/server/src/checkin/store.rs#L44)
- [Server parent canonicalization](https://github.com/tangramdotdev/tangram/blob/72729dd32b7458ea15259e366df5b8af1d137363/packages/server/src/checkin.rs#L100)
- [Store referent regression cases](https://github.com/tangramdotdev/tangram/blob/72729dd32b7458ea15259e366df5b8af1d137363/packages/cli/tests/checkin/store_path_referent.nu)

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
- The original assumed API was an artifact handle whose `to_referent()` retained
  full context. The user noted this could change. PR 1132 instead returns the
  full checkin output; that reviewed API supersedes the original assumption.
- After checkpoint `152095ec`, the user clarified that rust and std must be
  isolated packages: do not include source across package boundaries or assume
  stable monorepo layout. The tgrustc paths helper is now an intentional local
  copy, including its prepared tests. Its source bundle no longer includes the
  std workspace and places the crate directly at the bundle root.

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
- `packages/rust/tgrustc/src/paths.rs`: independent copy of the checkin and path
  helpers, included normally by `mod paths` in `main.rs`. Keep the incoming
  client API refinements consistent with std's helper without introducing a
  source dependency between the packages.
- `packages/rust/proxy.tg.ts`: bundles only tgrustc's Cargo manifest, lockfile,
  and source directory; builds the manifest at the bundle root.
- `packages/rust/tgrustc/src/outer.rs` and `runner.rs`, plus tgcc and tgstrip:
  consumers of the new path and authorization behavior.
- `common/src/manifest/tests.rs` and the tests in both package-local `paths.rs`
  modules: prepared regression coverage, not executed.

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
