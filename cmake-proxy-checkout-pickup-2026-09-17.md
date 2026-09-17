# CMake / linker-proxy pickup — September 17, 2026

## Read this first

The implementation is complete and its focused validation passed. **The full CMake test has not completed.** At the user's request, the running CMake build was canceled at approximately **22:21 UTC / 18:21 EDT on September 17, 2026**, in preparation for a reboot. The cancellation was verified, including the remaining dependency branch: no active processes were found in that canceled subtree.

The user's last requests were:

1. “Please cancel the running build and create a comprehensive pickup memory to survive a reboot.”
2. “push what you have to the remote as well”

This file and the implementation/experiment files are being included in that requested commit on `fix/restore-proxy-output-checkout`, followed by a push to `origin`. The commit containing this file is the pickup snapshot; obtain its exact hash with `git log -1`. Do not assume that the previous commit `227219e9` contains the complete fix.

Do not restart the canceled build merely while reading this handoff. When the user resumes the investigation after reboot, the outstanding action is the full CMake test. The user expects that test and its dependency rebuilds to take **30–60 minutes**.

## Workspace and workflow

- Repository: `/Users/benlovy/code/packages`.
- Related Tangram checkout: `/Users/benlovy/code/tangram`.
- Platform validated here: **aarch64-darwin**.
- Branch: **`fix/restore-proxy-output-checkout`**.
- Earlier pushed commit: **`227219e9a08954530a394cae5f3eb7042e77044d`**, `fix(std): restore direct proxy output checkout`.
- Earlier branch base: `71caaffc`, `refactor(std): unify wrapper and proxy controls (#211)`.
- No PR was opened, no merge was performed, and no package was published.
- The sibling Tangram checkout was not changed for this fix.

Read the repository `AGENTS.md` and `../tangram/AGENTS.md` before changing code. Apply the shared Style section, but use the package repository's workflow rules. In this repository, **format and package check commands run only when explicitly requested**. Neither was requested or run in this work. Rust tests, Tangram test exports, a production Rust build, and `git diff --check` were run.

Always use path-based Tangram build references beginning with `./` or `/`. Do not run a bare `tg build` in the repository root. There is no `tg test`; tests are exports built with `tg build`.

Use `--no-tokens` on `tg get`, `tg process get`, `tg process children`, and check-in/other commands that print referents. Do not paste raw authorization tokens into logs or handoffs. Access to `/opt/tangram/socket` required execution outside the filesystem sandbox for builds and cancellation. A sandbox failure trying to open the server start lock is an environment permission problem, not a regression in the proxy.

## The original problem and the historical correction

Original command:

```sh
tg build ./packages/cmake#test
```

Original failing process: **`pcs_0006gb13mse5tvvdzvggcjgc9bf8`**.

The failure was in the CMake dependency chain, through libpsl to Python 3.14.7. Python's initial `make` succeeded. During `make install`, `_bootstrap_python` was unnecessarily relinked and `pybuilddir.txt` was reset to `none`. The linker proxy's output had an epoch mtime, so Make did not regenerate the newer `pybuilddir.txt` as needed. The eventual error included:

```text
ModuleNotFoundError: No module named '_sysconfigdata__darwin_darwin'
```

The important distinction is between **immutable store mtimes** and the **mtime of a native tool's output in a mutable build directory**. Epoch mtimes in the Tangram store are intentional and longstanding. On macOS, an external checkout cloned from an already materialized store file inherits that epoch mtime, whereas a fresh external write gets a current mtime.

Refactor **`ed0b3b83` (#208)** added full-output materialization before external checkout in the common proxy helper. That made this inherited-epoch case systematic. Earlier commit `227219e9` changed the helper to materialize dependencies only, then check out the output directly. That restores the cold-output behavior, but experiments proved that a warm output can still inherit the epoch. The final implementation therefore explicitly preserves native output mtime in each proxy.

After `227219e9`, a full CMake rerun failed while building ncurses:

- CMake root: **`pcs_0006gb1hrqrdswk35q5xgcbrq400`**.
- Failing ncurses native child: **`pcs_0006gb1w34kxs3v0wqvkdhf5ekx8`**.
- Error: check-in hit `ENOENT` on a transient archive file such as `libncurses++w.a-io7X9F` while parallel archive operations were changing the directory.

We initially suggested that this race was unrelated to the change. The user challenged that, and the subsequent experiment/history inspection refined the answer:

- Both the post-refactor full-output and dependency-only helper variants can hit the race.
- That does **not** prove that the helper change had no scheduling effect on the observed ncurses failure.
- More importantly, **pre-refactor main did not check in the whole live library directory**.

Historical source **`a4e6b7b0` (`ed0b3b83^`)** used `checkin_local_library_path`: inspect directory entries, skip missing/nonregular/unrecognized entries, check in recognized libraries individually, and synthesize a library directory keyed by library names. Store paths reused artifact root/subpath context. Collection happened before library-path optimization, allowing the `none` strategy to retain libraries used only by `dlopen`.

The refactor changed local collection into whole-directory check-in, making unrelated archive temporary files inputs. Restoring individual library capture is the focused fix. **Do not revive the earlier broad proposal for generic live-directory snapshot/retry semantics as a prerequisite for this repair.**

## Final implemented semantics

### Output checkout and metadata

`packages/std/packages/common/src/lib.rs`, `checkout_artifact_to_path`, approximately line 63:

- The already committed `227219e9` helper materializes **dependencies only** before checking out the output to the caller's path.
- External checkout uses dependencies disabled, force enabled, and an attribute lock.
- This helper remains in place in the final implementation.

`packages/std/packages/tgld/src/main.rs`, `create_wrapper`, approximately line 228:

- Capture the native linker output's metadata before check-in and wrapping.
- After external checkout, restore its original modification time and permissions.
- Restore mtime before permissions, so restrictive final modes do not interfere with setting it.
- This handles both fresh and already materialized outputs without modifying store timestamps.
- Preserve the native operation's time, rather than assigning the time at which wrapper creation finishes.

`packages/std/packages/tgstrip/src/main.rs`, `run_proxy`, approximately line 89:

- Capture the caller wrapper's metadata.
- Copy the underlying executable from the store to a writable temporary file.
- Set that temporary input's mtime to the caller wrapper's mtime **before invoking native strip**. This matters for a native strip operation that preserves dates.
- After native strip, capture the temporary output's mtime.
- Rebuild/check out the wrapper, restore that post-strip mtime, and restore the original wrapper permissions.
- This change preserves mtime; it does not establish a new atime contract.
- Existing handling of embedded-wrapper strip operations is unchanged.

### Local library capture and artifact context

`packages/std/packages/tgld/src/main.rs`, `checkin_library_path`, approximately line 448:

1. Canonicalize the requested library directory. Missing/non-directory paths produce no library directory.
2. Enumerate and sort entry paths for deterministic handling.
3. Skip entries that disappear before selection, are not regular files, or are not recognized runtime libraries. Metadata follows symlinks; FIFOs and archive temporary files are not selected.
4. Check in each selected library individually. Errors in that selected file's check-in propagate.
5. If the returned referent identifies a containing immutable artifact, recover its root and the parent of the library's subpath, preserving server-returned authorization/context, and use that immutable directory.
6. Otherwise collect local files into a synthetic directory. Resolve local library symlink targets to authorized file artifacts.
7. Retain the real filenames and add missing SONAME/install-name aliases. Real filenames win over colliding aliases.
8. Apply the existing library-path optimization policy after collection. The `none` policy retains recognized libraries needed only at runtime through `dlopen`.

`library_directory_from_referent`, approximately line 520, uses `common::artifact_path` and the returned referent, **not artifact IDs parsed from store path strings**. Its unit test covers local referents and containing directory subpaths such as `lib/libexample.so`, `usr/lib/libexample.so`, and a library at the artifact root.

The final code also introduces `is_library` in `AnalyzeOutputFileOutput` and its binary analysis, approximately lines 660 and 1123:

- ELF shared libraries qualify even without SONAME; PIE executables do not.
- Mach-O dylibs and loadable bundles qualify, including bundles without an install name.
- Archives and relocatable object files do not qualify.
- Fat Mach-O analysis accumulates the library classification across slices.

This avoids accidentally dropping unnamed runtime libraries while restoring the older selection strategy. The implementation is therefore not a literal copy of pre-refactor code: it keeps the refactor's context/authorization handling, adds explicit timestamp preservation, retains filenames/aliases, and recognizes unnamed libraries and bundles.

The existing configurable missing-library policy is preserved. The experiment enables disallow-missing and confirms that removing a required library after native linking produces an error. It does not claim that a policy explicitly allowing missing libraries must reject them. Concurrent mutation of a selected required library remains outside the experiment's consistency guarantees.

## Regression coverage

`packages/std/sdk/proxy.tg.ts`:

- `testLinkerOutputCheckout`, approximately line 984, now places an unrelated FIFO and an archive-like text file in the local library directory. Whole-directory check-in would fail deterministically on that directory. The test links, checks timestamp ordering, removes the local shared library, and executes the program.
- On Linux, this test deliberately omits SONAME to exercise filename-based capture. On Darwin it supplies an install name.
- `testProxyOutputMetadata`, approximately line 1018, supplies hooks around the real native linker and strip tools. The hooks produce known mtimes and mode `0751`, and the test checks exact time equality, permissions, and execution.
- The strip hook covers both a tool that changes mtime and one that preserves the input date.
- The test is part of the main proxy `test` export.
- The test scripts intentionally use `#!/bin/sh`. An earlier attempt to use a nonexistent shell under the bootstrap-utils artifact failed; that harness error was fixed before the successful runs.
- Linux embedded and ordinary linker-output cases are represented in the test code, but only Darwin execution was validated in this session.

Rust coverage extends the existing executable-analysis test with shared-library classification, relocatable-object exclusion, and an unnamed Mach-O bundle. There are **17 passing Rust tests total**: common 3, tgld 12, tgstrip 2.

## Minimal experiment and recorded evidence

All durable experiment files are in `experiments/proxy-checkout/`:

| File | Purpose |
| --- | --- |
| `README.md` | Reproduction, interpretation, limits, and validation. |
| `prepare.py` | Extract commit `227219e9` with `git archive`, instrument temporary Rust sources, and build experimental proxies. |
| `run.py` | Tiny native C fixture and repeated race/timestamp/runtime checks. |
| `results.json` | Raw measurements from the four baseline helper variants. |
| `production-results.json` | Raw measurements from the final production implementation. |

The baseline experiment used the **post-refactor scanner in every variant**. It did not execute pre-refactor main. Keep that distinction explicit when explaining results.

| Baseline variant | Cold Make freshness | Warm Make freshness | Exact native mtime | Archive-churn failures | Selected-files failures |
| --- | --- | --- | --- | --- | --- |
| Full-output materialization | Fail | Fail | No | 19/20 | 0/20 |
| Dependencies-only materialization | Pass | Fail | No | 15/20 | 0/20 |
| Full-output + explicit mtime | Pass | Pass | Yes | 11/20 | 0/20 |
| Dependencies-only + explicit mtime | Pass | Pass | Yes | 19/20 | 0/20 |

Stable-directory links succeeded in every baseline case. The race counts establish that the race can occur; they do not quantify reliable relative failure probabilities or prove that scheduling was unaffected by the first patch.

The final production implementation passed:

- Exact native mtime and Make freshness for cold and warm shared libraries, executables, and stripped executables.
- Identical artifact IDs across identical relinks, with store mtimes remaining zero before and after warm runs.
- Transitive library dependencies after hiding the original local library directory.
- Runtime execution after strip, retaining mode `0751`.
- Direct library symlink arguments and checked-out package `/lib` subpaths.
- `dlopen` of unlinked libraries under `none`; expected omission under `isolate`.
- A loadable bundle with no install name under `none`.
- **0/20 failures** in each of stable, unrelated-archive-churn, and selected-files controls.
- Expected failure when a required library disappears after native linking, with disallow-missing enabled.

The final report was independently checked with Python assertions covering every timestamp, identity, store-mtime, runtime, race, required-missing, and strip-mode result. Both Python experiment scripts were syntax-parsed. `git diff --check` passed.

Historical temporary directories, which may disappear during reboot:

- Baseline logs: `/private/tmp/proxy-checkout-experiment/run-arca13ns`.
- First production run before unnamed-bundle coverage: `/private/tmp/proxy-checkout-production/run-7404crq7`.
- **Final production run:** `/private/tmp/proxy-checkout-production/run-8hgbumko`.

The two raw JSON reports are copied into the repository, so those temporary directories are not needed to recover the conclusions. Temporary binaries can be rebuilt from the committed sources. The fixture's SDK artifacts live under `/opt/tangram/store`, subject to normal store lifetime/garbage collection.

## Exact validation state and process IDs

| Check | Result / process |
| --- | --- |
| Final Rust unit tests | Passed, 17 tests, plus empty doc-test sets. |
| Final local Rust production build | Passed. |
| Final production experiment | Passed; `production-results.json`. |
| **Final full SDK proxy suite** | **Passed, output `true`, exit 0:** `pcs_0006gb2rzcb1r4kaf39w2ydxtv34`. Finished at approximately 22:18:36 UTC. |
| **Final full CMake test** | **Intentionally canceled by user:** `pcs_0006gb2s08yhtbq66r3srax0jzr4`. Status `finished`, exit 1, cancellation error. Started approximately 22:01:58 UTC and canceled at 22:21:32 UTC. |
| Final CMake environment child | `pcs_0006gb2s1dd9sev1hwyp6tr79e50`, also finished/canceled. |
| Final CMake bootstrap libiconv | `pcs_0006gb2w4ymdtdz3tc4pa8j97kgc`, passed. |
| Final CMake bootstrap Coreutils | `pcs_0006gb2wryw1t2q97gb98wp7e1q0`, passed through installation. |
| Final SDK native Rust build | `pcs_0006gb2sdpmxrzx979nzeswf41ew`, passed. |

The last CMake run finished SDK/bootstrap preparation and source patching, and had begun the main utility environment before cancellation. **It had not demonstrated that the full ncurses/Python/CMake chain succeeds with the final code.** Cancellation must not be reported as an actual build regression.

Earlier useful records:

- Original failing CMake: `pcs_0006gb13mse5tvvdzvggcjgc9bf8`.
- First dependency-only CMake rerun: `pcs_0006gb1hrqrdswk35q5xgcbrq400`.
- Its ncurses race: `pcs_0006gb1w34kxs3v0wqvkdhf5ekx8`.
- Individual checkout regression, before final unnamed-library extension: `pcs_0006gb2kme95t5f6vzqwnkvy9tj8`, passed.
- Individual metadata regression with corrected shell hook: `pcs_0006gb2m6051vrzdp2y4ex46za4g`, passed.
- Earlier full proxy suite before the final classification extension: `pcs_0006gb2mh1j9vgn73rgb9tr6dc8g`, passed.
- Earlier CMake attempt `pcs_0006gb2kmrg9sak750m4s4h9ptcc` was intentionally canceled to restart with the final classification change. Do not diagnose its cancellation as a failure.
- Initial metadata-test harness failure `pcs_0006gb2jm4z5t3z0qt1tfjpys7n0` was caused by the nonexistent shell path, not by the production metadata code. The final full suite supersedes it.

No build was restarted after the user's reboot/cancellation request. The cancellation command returned successfully, the attached CLI exited with “the process was canceled,” and a follow-up traversal found no active processes in the canceled branch.

## Resume after reboot

First inspect the checkout and this snapshot:

```sh
cd /Users/benlovy/code/packages
git status --short
git branch --show-current
git log -2 --oneline
```

Once the user is ready to resume the long validation:

```sh
tg build --retry --no-tokens ./packages/cmake#test
```

`--retry` allows retrying canceled/failed cached processes. Save the new root process ID and retain its lease privately if cancellation may be needed. Completed dependencies should remain reusable if the Tangram store survives the reboot. The source/tests were not changed after the successful final proxy suite, so there is no need to rebuild unrelated tests just to resume CMake.

For progress and diagnosis:

```sh
tg process get PROCESS_ID --no-tokens
tg process children PROCESS_ID --no-tokens
tg log --timeout 1sec --position end.-3000 --length 3000 PROCESS_ID
```

The end-relative log syntax is **`end.-3000`**, not a bare negative integer. `--timeout` needs a unit such as `1sec`.

Inspect actual process statuses when walking children: **`cached: true` can refer to a still-running shared child**. Do not drop all cached children when looking for active work. `tg process children` is useful for the live child list; a previously fetched process object can contain only an earlier partial list. Full logs can be huge, so retrieve a bounded tail or save them to a file before searching.

If the resumed CMake run fails, inspect the specific failed native child and establish its cause. Do not declare it unrelated to this patch without evidence. If it passes, record the root ID/result in the experiment documentation or this pickup and report the complete validation. No additional production change is currently planned.

Useful commands if code changes justify repeating focused tests:

```sh
cargo test --manifest-path packages/std/Cargo.toml --package common --package tgld --package tgstrip --offline
tg build --no-tokens ./packages/std/sdk/proxy.tg.ts#test
tg build --no-tokens ./packages/std/sdk/proxy.tg.ts#testLinkerOutputCheckout
tg build --no-tokens ./packages/std/sdk/proxy.tg.ts#testProxyOutputMetadata
```

Rebuild/run the production experiment without relying on `/tmp` binaries:

```sh
cargo build --manifest-path packages/std/Cargo.toml --package tgld --package tgstrip --offline
python3 experiments/proxy-checkout/run.py \
  --proxies packages/std/target/debug \
  --sdk /opt/tangram/store/dir_0180q2ng1e9tj3qed21tfharqex4naq411d59nedt0abfp3nfnmf90 \
  --production --trials 20
```

This runner targets macOS and uses `/usr/bin/clang` and `/usr/bin/strip`. It obtains the wrapper/injection/codesign settings from the wrapped SDK `bin/ld`. Its default local server URL is `http+unix://%2Fopt%2Ftangram%2Fsocket`. If the fixture SDK is absent, check out that artifact again if available, or obtain a current bootstrap SDK and pass its checkout path; the exported function is `./packages/std/bootstrap/sdk.tg.ts#sdk`.

Re-running the baseline matrix is optional; the raw evidence is already saved. If necessary:

```sh
python3 experiments/proxy-checkout/prepare.py /tmp/proxy-checkout-experiment
python3 experiments/proxy-checkout/run.py \
  --proxies /tmp/proxy-checkout-experiment \
  --sdk /opt/tangram/store/dir_0180q2ng1e9tj3qed21tfharqex4naq411d59nedt0abfp3nfnmf90 \
  --trials 20
```

`prepare.py` intentionally builds the archived `227219e9` sources with experimental switches, not the current production sources. It reuses `packages/std/target`, so **rebuild production binaries afterward** before using `packages/std/target/debug/tgld` or `tgstrip` for production validation. The experimental environment switches exist only in the temporary instrumented sources.

## Limits and remaining review considerations

- The final full proxy suite and runtime experiment ran on Darwin. Linux test branches are present but were not executed on a Linux host here.
- The experiment did not establish Linux embedded/static executable behavior or restricted-process authorization by itself. The implementation retains authorized referents and existing policies, and the Darwin SDK suite passed.
- Date-preserving strip behavior was verified with a native-tool hook; an actual GNU `strip -p` run was not performed on this macOS host.
- The archive churn test holds the required libraries stable. It does not provide a snapshot guarantee for concurrent mutation of a required shared library.
- The full CMake test remains the only outstanding validation identified at handoff.

## Unrelated local files to preserve

The following files were already untracked before this work and must not be accidentally staged, removed, or overwritten while committing/resuming this change:

```text
AGENTS.md
Claude.md
cacert-2026-07-16.pem.sha256
checkin-path-handling-pickup-2026-09-14.md
client.log
ripgrep-checkout-permissions-pickup-2026-09-16.md
tangram-rust-pickup-2026-09-04.md
tangram-rust-test-failures.md
unified-proxy-controls-handoff-2026-09-15.md
unified-proxy-controls-handoff-2026-09-16.md
unified-proxy-controls-plan.md
wrap_deps_probe.tg.ts
wrapper-mapped-manifest-design.md
wrapper-mapped-manifest-review.md
```

The intended new commit includes only the three modified implementation/test files, the five files under `experiments/proxy-checkout/`, and this pickup file. The earlier common-helper change remains in parent commit `227219e9`.
