# Proxy checkout semantics experiment

This experiment isolates the Python timestamp failure and the ncurses directory-scan race using small C programs. It does not build Python, ncurses, or CMake. The production source baseline is `227219e9`.

`prepare.py` copies the Rust workspace from commit `227219e9` into a temporary directory and adds two experimental switches. It compiles one pair of proxies, so the four cases use the same binaries:

| Case | Materialize before the external checkout | Preserve the native tool's output mtime |
| --- | --- | --- |
| `full` | The output and its dependencies, as before `227219e9`. | No. |
| `dependencies` | Only the dependencies, as in `227219e9`. | No. |
| `full_restore` | The output and its dependencies. | Yes. |
| `dependencies_restore` | Only the dependencies. | Yes. |

The linker experiment captures the native linker's mtime before wrapping. The strip experiment captures the stripped temporary executable's mtime before wrapping. Neither changes generic Tangram checkout semantics. The experimental Rust uses assertions and `unwrap` deliberately; it is instrumentation, not a production patch.

## Run

Requirements: macOS, the local Tangram server, Xcode command-line tools, cached Rust dependencies, and an already checked-out SDK with a wrapped `bin/ld`. This SDK supplies the existing wrapper, injection library, and codesign tool. The native compiler and strip tool are `/usr/bin/clang` and `/usr/bin/strip`.

From the repository root:

```sh
python3 experiments/proxy-checkout/prepare.py /tmp/proxy-checkout-experiment
python3 experiments/proxy-checkout/run.py \
  --proxies /tmp/proxy-checkout-experiment \
  --sdk /opt/tangram/store/dir_0180q2ng1e9tj3qed21tfharqex4naq411d59nedt0abfp3nfnmf90 \
  --trials 20
```

The runner prints its result directory and saves `results.json` and individual failure logs there. Each execution gets unique library contents. Within each case it repeats identical links and verifies the resulting artifact IDs are identical. To force a warm checkout, it explicitly materializes the first output in the store before repeating the operation.

The preparation step reuses `packages/std/target` to avoid rebuilding dependencies. It copies the experimental binaries into the supplied temporary directory. To restore the normal development binaries afterward:

```sh
cargo build --manifest-path packages/std/Cargo.toml --package tgld --package tgstrip --offline
```

## Measurements

- Compare the wrapper or shared library's mtime with the native tool's mtime, and run `make -q` against its object-file prerequisite. Repeat for cold and warm executable, shared-library, and strip outputs.
- Confirm that warm runs reuse the same artifact IDs and that the store copies retain epoch mtimes.
- Run a program with a transitive shared-library dependency after moving its local library directory away. Repeat after stripping, preserving an unusual executable mode of `0751`.
- Link through a direct library symlink and through a checked-out package's `/lib` subpath, then run without the original local library directory.
- Open an otherwise unreferenced library with `dlopen`. The `none` library-path strategy must retain it; `isolate` intentionally does not. The production run also covers a loadable bundle without an install name.
- Create and remove 128 unrelated `libunrelated.a-*` files in the searched library directory while linking. The required libraries remain unchanged. Compare this with a stable directory and with staging only the two known required libraries before check-in, while the original directory continues changing.
- Remove a required library immediately after the native linker succeeds. With the disallow-missing policy enabled, the proxy must still reject the incomplete dependency set.

The race is timing-dependent. The counts demonstrate that a failure is possible; they do not establish a reliable difference in failure probability between policies. The selected-files control models a smaller snapshot scope using the known dependencies of this fixture. It is not an implementation of a general dependency resolver.

## Observed results, September 17, 2026

The [recorded measurements](results.json) come from `/private/tmp/proxy-checkout-experiment/run-arca13ns`. Each race scenario ran 20 times per policy.

| Policy | Cold Make check | Warm Make check | Exact native mtime | Failures with unrelated archive changes | Failures with selected files |
| --- | --- | --- | --- | --- | --- |
| `full` | Fail. | Fail. | No. | 19/20. | 0/20. |
| `dependencies` | Pass. | Fail. | No. | 15/20. | 0/20. |
| `full_restore` | Pass. | Pass. | Yes. | 11/20. | 0/20. |
| `dependencies_restore` | Pass. | Pass. | Yes. | 19/20. | 0/20. |

The timestamp results were identical for shared-library, executable, and strip outputs. Every warm case reproduced its cold artifact ID, and every recorded store mtime remained zero. Every stable-directory link succeeded. All failures during archive changes occurred in check-in; they included the same metadata `ENOENT` as the ncurses failure, as well as disappearance during later file reads.

All runtime and permission checks passed, including transitive dependencies, stripping, direct symlink arguments, package subpaths, and execution after moving local libraries away. The `dlopen` program succeeded with `none` and failed with `isolate`, as expected. Every policy rejected a required library removed after the native linker completed.

The previous full-output checkout behavior can exhibit the directory race: the dependency-only patch is not necessary to produce it. This does not prove that the patch had no effect on scheduling in the original ncurses build. Restoring the previous checkout behavior alone also does not provide cache-independent timestamp semantics.

Here, "previous" means the checkout helper immediately before `227219e9`, after the refactor. Every experimental variant retains the refactored library scanner. These results are not an execution of the complete pre-refactor main.

Historical inspection of `a4e6b7b0`, immediately before `ed0b3b83`, found a narrower local input strategy: `checkin_local_library_path` analyzed directory entries and checked in recognized shared-library files individually, then built a directory keyed by library names. It skipped entries whose metadata or binary analysis failed. It collected all recognized libraries before applying the optimization policy, allowing the `none` policy to retain libraries used only by `dlopen`. Store paths reused their artifact and subpath context. Restoring this local-library collection approach, while retaining the refactor's authorization/context fixes, is a smaller next step than introducing a general live-directory snapshot/retry policy. The historical scanner has not been run in this experiment.

## Production implementation

The implementation restores individual local-library capture and explicitly preserves the native output mtime in the linker and strip proxies. A library check-in that returns an immutable containing artifact lets the scanner retain the server-provided root, subpath, and authorization. Local captures retain real filenames and install-name or SONAME aliases, including libraries used only by `dlopen` under the `none` policy.

To run the same fixture against the production binaries:

```sh
cargo build --manifest-path packages/std/Cargo.toml --package tgld --package tgstrip --offline
python3 experiments/proxy-checkout/run.py \
  --proxies packages/std/target/debug \
  --sdk /opt/tangram/store/dir_0180q2ng1e9tj3qed21tfharqex4naq411d59nedt0abfp3nfnmf90 \
  --production --trials 20
```

The [production measurements](production-results.json) passed every cold/warm timestamp, runtime, permissions, artifact identity, and store timestamp check, including the unnamed bundle. All 20 links succeeded in each of the stable, unrelated-archive-change, and selected-files scenarios. A required library removed after linking still caused an error. The production run used binaries copied from the development target into `/tmp/proxy-checkout-production`; its logs are in `/private/tmp/proxy-checkout-production/run-8hgbumko`.

The SDK regression `testLinkerOutputCheckout` now includes an unrelated FIFO to verify deterministically that the live directory is not checked in wholesale. `testProxyOutputMetadata` supplies native tool outputs with known mtimes and tests ordinary and date-preserving strip behavior.

The final implementation passed all 17 Rust tests in `common`, `tgld`, and `tgstrip`. The complete SDK proxy test export also returned `true` on aarch64-darwin: `pcs_0006gb2rzcb1r4kaf39w2ydxtv34`.

On September 18, the full CMake package test passed with the final implementation: `pcs_0006gbahmjnxtsz51esm865m6f88`, exit 0, output `true`. Verification retrieved the existing successful result for the current checkout with `tg build --cached=true --no-tokens ./packages/cmake#test`; it did not start another build. The native Python, ncurses, libpsl, CMake, and Ninja build processes in that dependency graph all exited successfully, including the two earlier failure points. The [CMake verification record](cmake-results.json) preserves the process IDs, parent edges, output artifacts, and completion times. This closes the remaining macOS validation; Linux execution remains outside the recorded coverage.

## Semantics supported by the experiment

1. Store artifacts retain deterministic epoch timestamps. A proxy's local output retains the native operation's mtime and permissions, independently of cache state. Preserving the native mtime also avoids making wrapper creation time part of the observable build semantics.
2. Runtime dependencies are available before the proxy returns. Timestamp preservation works with both materialization policies; dependency-only checkout by itself does not guarantee correct warm-output timestamps.
3. Unrelated archive temporary files should not become inputs merely because they share a directory with a required library. The implementation captures recognized local shared libraries individually, then applies the existing library-path optimization policy, preserving aliases, artifact context, and authorization.
4. The `none` policy must retain libraries needed only by `dlopen`, including unnamed loadable bundles. A universal switch to capturing only linked libraries would break this case. Restoring individual library capture avoids needing a general snapshot/retry policy for the entire live directory; concurrent mutation of a selected library remains an error.
5. A required library disappearing is an error when the disallow-missing policy is enabled, as in this fixture. Once a library is selected for check-in, its check-in errors propagate. The implementation preserves the existing configurable missing-library policy.

The timestamp result favors explicit mtime preservation at the linker and strip operation boundaries. It does not select full versus dependency-only materialization on performance grounds. The directory race requires a separate input-capture decision.

## Limits

This is a macOS experiment with ordinary executable wrappers and native shared libraries. It does not establish Linux embedded/static executable behavior, restricted process authorization, or native date-preserving strip flags. The SDK metadata regression separately supplies a date-preserving strip hook. For such a tool, the implementation gives the temporary input the caller's mtime before invoking it; preserving the output timestamp alone may otherwise preserve the store's epoch timestamp. Concurrent mutation of a required library remains outside this experiment's guarantees.

The original four-policy experiment makes no production source changes. The later production implementation is validated separately above. Neither result alone constitutes a successful full CMake build.
