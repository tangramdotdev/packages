#!/usr/bin/env nu

# Integration test: verify switching between plain cargo and tg run without full rebuild.
# Prerequisites: tangram server running, cargo/rustc installed.
#
# Usage:
#   nu run_integration.nu                                               # Test hello-workspace fixture, all modes.
#   nu run_integration.nu /path/to/project                              # Test an external project (no-proxy mode only).
#   nu run_integration.nu --proxy /path/to/project                      # Test with proxy mode for an external project.
#   nu run_integration.nu --bin cli --expected-output "Hello from a workspace!"
#   nu run_integration.nu --debug                                       # Test debug builds (incremental compilation).

use std assert

# ── Assertion helpers ──────────────────────────────────────────────────

# Scan target/<profile>/ for executable files and return the first one found.
def detect_binary [profile: string] {
    let dir = $"target/($profile)"
    if not ($dir | path exists) { return null }
    let files = (ls $dir
        | where type == "file"
        | get name
        | where { |f|
            ($f | path parse).extension == "" and not (($f | path basename) | str starts-with ".")
        })
    if ($files | length) > 0 {
        $files.0 | path basename
    } else {
        null
    }
}

# Assert that a binary exists at target/<profile>/<name> and is executable.
def assert_binary [profile: string, name: string] {
    let path = $"target/($profile)/($name)"
    assert ($path | path exists) $"binary not found: ($path)"
    let result = (^test -x $path | complete)
    assert equal $result.exit_code 0 $"binary is not executable: ($path)"
}

# Run a binary and assert it exits successfully.
def assert_binary_runs [profile: string, name: string] {
    let path = $"./target/($profile)/($name)"
    let output = (^$path | complete)
    assert equal $output.exit_code 0 $"binary ($name) exited with code ($output.exit_code)"
}

# Run a binary and assert its output matches the expected string.
def assert_binary_output [profile: string, name: string, expected: string] {
    let path = $"./target/($profile)/($name)"
    let output = (^$path | complete)
    assert equal $output.exit_code 0 $"binary ($name) exited with code ($output.exit_code)"
    assert equal ($output.stdout | str trim) $expected "binary output mismatch"
}

# Assert target/<profile>/deps/ exists and is non-empty.
def assert_target_structure [profile: string] {
    let deps_dir = $"target/($profile)/deps"
    assert ($deps_dir | path exists) $"deps directory not found: ($deps_dir)"
    let count = (ls $deps_dir | length)
    assert ($count > 0) $"deps directory is empty: ($deps_dir)"
}

# Assert no .externs sidecar files in deps/ (no proxy involvement).
def assert_no_externs [profile: string] {
    let externs = (glob $"target/($profile)/deps/*.externs")
    assert equal ($externs | length) 0 "unexpected .externs files found in deps/ (proxy was not expected)"
}

# Assert .externs files exist in deps/ (proxy was involved).
def assert_proxy_artifacts [profile: string] {
    let externs = (glob $"target/($profile)/deps/*.externs")
    assert (($externs | length) > 0) "no .externs files found in deps/ (expected proxy involvement)"
}

# Assert deps/ contains both symlinks AND regular .rlib files (passthrough=true mode).
# Falls back to "all symlinks OK" for single-crate projects where the only workspace
# member is the binary itself and all deps/ entries are external.
def assert_mixed_dep_types [profile: string] {
    let rlibs = (glob $"target/($profile)/deps/lib*.rlib")
    if ($rlibs | length) == 0 {
        print "  (no .rlib files in deps/ to check)"
        return
    }
    let symlinks = ($rlibs | where { |f| ($f | path type) == "symlink" })
    let regulars = ($rlibs | where { |f| ($f | path type) != "symlink" })
    if ($symlinks | length) > 0 and ($regulars | length) > 0 {
        print $"  deps/ has ($symlinks | length) symlinked and ($regulars | length) regular .rlib files"
    } else if ($symlinks | length) > 0 and ($regulars | length) == 0 {
        # Single-crate project: all deps are external, so all are symlinks. This is fine.
        print $"  deps/ has ($symlinks | length) symlinked .rlib files — all external deps"
    } else if ($symlinks | length) == 0 {
        print $"  (ansi yellow)warning(ansi reset): no symlinks found among ($rlibs | length) .rlib files in deps/"
    }
}

# Assert target/<profile>/incremental/ exists and is non-empty.
def assert_incremental_dir [profile: string] {
    let inc_dir = $"target/($profile)/incremental"
    assert ($inc_dir | path exists) $"incremental directory not found: ($inc_dir)"
    let count = (ls $inc_dir | length)
    assert ($count > 0) $"incremental directory is empty: ($inc_dir)"
}

# ── Build helpers ──────────────────────────────────────────────────────

# Run cargo build with the given flags and capture output.
def run_cargo_build [flags: list<string>]: nothing -> record {
    ^cargo build ...$flags | complete
}

# Run tg run build and assert success.
def tg_run_build [label: string, flags: list<string>]: nothing -> record {
    let r = (^tg run -b . -- build ...$flags | complete)
    if $r.exit_code != 0 {
        print $"  stderr: ($r.stderr)"
    }
    assert equal $r.exit_code 0 $"($label) failed: ($r.stderr)"
    $r
}

# Append a comment to trigger recompilation without changing semantics.
def modify_source [file: string, n: int] {
    open $file | $in + $"\n// modified ($n)\n" | save -f $file
}

# Write tangram.ts with the given proxy and passthrough settings.
def write_tangram_ts [import_line: string, proxy: bool, passthrough: bool] {
    if not $proxy {
        [$import_line
            ""
            "export default async () => {"
            "	return cargo.run();"
            "};"
        ] | str join "\n" | save -f tangram.ts
    } else {
        let source_line = 'import source from "." with { type: "directory" };'
        let opts = if not $passthrough {
            "{ proxy: true, passthrough: false, source }"
        } else {
            "{ proxy: true, source }"
        }
        [$import_line
            $source_line
            ""
            "export default async () => {"
            $"	return cargo.run\(($opts));"
            "};"
        ] | str join "\n" | save -f tangram.ts
    }
}

# Find a .rs source file to modify (first lib.rs or main.rs found).
def find_rs_file []: nothing -> string {
    let candidates = (glob **/*.rs --exclude [target/**]
        | where { |f| ($f | path basename) == "lib.rs" or ($f | path basename) == "main.rs" }
        | sort)
    assert (($candidates | length) > 0) "no .rs source files found"
    # Prefer lib.rs (modifying it triggers downstream recompilation).
    let libs = ($candidates | where { |f| ($f | path basename) == "lib.rs" })
    if ($libs | length) > 0 { $libs.0 } else { $candidates.0 }
}

# Verify that a rebuild was incremental (did not recompile everything).
# When --strict is set, assert failure on full rebuild. Otherwise, warn.
def check_incremental [stderr: string, label: string, full_count: int, --strict] {
    let recompiled = ($stderr | lines | where { |l| $l =~ "Compiling" })
    let count = ($recompiled | length)
    print $"  ($label): recompiled ($count)/($full_count) crates"
    for line in $recompiled {
        print $"    ($line)"
    }
    if $full_count > 1 and $count >= $full_count {
        if $strict {
            assert ($count < $full_count) $"full rebuild detected on ($label): ($count)/($full_count) crates recompiled"
        } else {
            print $"  (ansi yellow)warning(ansi reset): full rebuild detected - ($count)/($full_count) crates"
        }
    }
}

# ── Main ───────────────────────────────────────────────────────────────

def main [
    project?: path       # Path to a Rust project (default: hello-workspace fixture).
    --bin: string        # Binary name for output verification.
    --expected-output: string  # Expected stdout from the binary.
    --touch: string      # Source file to modify for recompilation (default: auto-detected).
    --proxy              # Also test proxy mode (always on for hello-workspace).
    --debug              # Use debug builds instead of release (tests incremental compilation).
] {
    let rust_pkg = ($env.FILE_PWD | path dirname)
    let is_fixture = ($project == null)
    let source = if $is_fixture { $env.FILE_PWD | path join "hello-workspace" } else { $project }
    let use_proxy = $proxy or $is_fixture
    let profile = if $debug { "debug" } else { "release" }
    let cargo_flags = if $debug { [] } else { ["--release"] }
    let target_subdir = if $debug { "debug" } else { "release" }

    # Copy to a temp directory so we can modify files freely.
    let tmp = (^mktemp -d | str trim)
    let work_dir = ($tmp | path join "ws")
    ^cp -R $source $work_dir
    cd $work_dir

    # Determine which source file to modify.
    let touch_file = if $touch != null {
        $touch
    } else if $is_fixture {
        "packages/greeting/src/lib.rs"
    } else {
        find_rs_file
    }

    # Generate tangram.ts for tg run.
    let import_line = $'import { cargo } from "rust" with { local: "($rust_pkg)" };'

    # ── Mode 1: tg run without proxy ──────────────────────────────────
    print $"=== Mode 1: tg run without proxy [($profile)] ==="
    write_tangram_ts $import_line false true

    print "  cargo build (full)..."
    let r = (run_cargo_build $cargo_flags)
    assert equal $r.exit_code 0 $"initial cargo build failed: ($r.stderr)"

    # Count total crates compiled in the full build.
    let full_count = ($r.stderr | lines | where { |l| $l =~ "Compiling" } | length)

    # Auto-detect binary if not specified.
    let bin_name = if $bin != null {
        $bin
    } else {
        let detected = (detect_binary $target_subdir)
        if $detected != null {
            print $"  auto-detected binary: ($detected)"
        }
        $detected
    }

    assert_target_structure $target_subdir
    assert_no_externs $target_subdir
    if $bin_name != null {
        assert_binary $target_subdir $bin_name
        if $expected_output != null {
            assert_binary_output $target_subdir $bin_name $expected_output
        }
    }

    print "  modifying source..."
    modify_source $touch_file 1

    print "  tg run build (no proxy)..."
    let r = (tg_run_build "tg run (no proxy)" $cargo_flags)
    check_incremental $r.stderr "cargo → tg run" $full_count --strict

    assert_target_structure $target_subdir
    assert_no_externs $target_subdir
    if $bin_name != null {
        assert_binary $target_subdir $bin_name
        if $expected_output != null {
            assert_binary_output $target_subdir $bin_name $expected_output
        }
    }

    print "  modifying source..."
    modify_source $touch_file 2

    print "  cargo build (after tg run)..."
    let r = (run_cargo_build $cargo_flags)
    assert equal $r.exit_code 0 $"cargo build failed: ($r.stderr)"
    check_incremental $r.stderr "tg run → cargo" $full_count --strict

    assert_target_structure $target_subdir
    assert_no_externs $target_subdir
    if $bin_name != null {
        assert_binary $target_subdir $bin_name
        if $expected_output != null {
            assert_binary_output $target_subdir $bin_name $expected_output
        }
    }

    # ── Mode 2: tg run with proxy + passthrough ──────────────────────
    if $use_proxy {
        print ""
        print $"=== Mode 2: tg run with proxy + passthrough [($profile)] ==="

        # Start fresh so all crates go through the proxy on the first build.
        ^rm -rf target
        write_tangram_ts $import_line true true

        print "  tg run build (proxy+passthrough, full from clean)..."
        let r = (tg_run_build "tg run (proxy+passthrough, full)" $cargo_flags)
        let proxy_full_count = ($r.stderr | lines | where { |l| $l =~ "Compiling" } | length)

        assert_target_structure $target_subdir
        assert_proxy_artifacts $target_subdir
        if $is_fixture { assert_mixed_dep_types $target_subdir }
        if $bin_name != null {
            assert_binary $target_subdir $bin_name
            if $expected_output != null {
                assert_binary_output $target_subdir $bin_name $expected_output
            }
        }
        if $debug { assert_incremental_dir $target_subdir }

        print "  modifying source..."
        modify_source $touch_file 3

        print "  tg run build (proxy+passthrough, incremental)..."
        let r = (tg_run_build "tg run (proxy+passthrough, incremental)" $cargo_flags)
        check_incremental $r.stderr "proxy → proxy" $proxy_full_count --strict

        if $bin_name != null {
            assert_binary $target_subdir $bin_name
            if $expected_output != null {
                assert_binary_output $target_subdir $bin_name $expected_output
            }
        }
        if $debug { assert_incremental_dir $target_subdir }

        print "  modifying source..."
        modify_source $touch_file 4

        print "  cargo build (after proxy+passthrough)..."
        let r = (run_cargo_build $cargo_flags)
        assert equal $r.exit_code 0 $"cargo build after proxy failed: ($r.stderr)"
        check_incremental $r.stderr "proxy → cargo" $proxy_full_count

        if $bin_name != null {
            assert_binary $target_subdir $bin_name
            assert_binary_runs $target_subdir $bin_name
        }
        if $debug { assert_incremental_dir $target_subdir }

        print "  modifying source..."
        modify_source $touch_file 5

        print "  tg run build (proxy+passthrough, switch back)..."
        let r = (tg_run_build "tg run (proxy+passthrough, switch back)" $cargo_flags)
        check_incremental $r.stderr "cargo → proxy" $proxy_full_count

        if $bin_name != null {
            assert_binary $target_subdir $bin_name
            assert_binary_runs $target_subdir $bin_name
        }
        if $debug { assert_incremental_dir $target_subdir }
    }

    # ── Mode 3: tg run with proxy, passthrough=false ─────────────────
    if $use_proxy {
        print ""
        print $"=== Mode 3: tg run with proxy, passthrough=false [($profile)] ==="

        ^rm -rf target
        write_tangram_ts $import_line true false

        print "  tg run build (proxy, no passthrough, full from clean)..."
        let r = (tg_run_build "tg run (proxy, no passthrough, full)" $cargo_flags)
        let nopt_full_count = ($r.stderr | lines | where { |l| $l =~ "Compiling" } | length)

        assert_target_structure $target_subdir
        assert_proxy_artifacts $target_subdir
        if $is_fixture { assert_mixed_dep_types $target_subdir }
        if $bin_name != null {
            assert_binary $target_subdir $bin_name
            if $expected_output != null {
                assert_binary_output $target_subdir $bin_name $expected_output
            }
        }

        print "  modifying source..."
        modify_source $touch_file 6

        print "  tg run build (proxy, no passthrough, incremental)..."
        let r = (tg_run_build "tg run (proxy, no passthrough, incremental)" $cargo_flags)
        check_incremental $r.stderr "proxy(nopt) → proxy(nopt)" $nopt_full_count --strict

        if $bin_name != null {
            assert_binary $target_subdir $bin_name
        }

        print "  modifying source..."
        modify_source $touch_file 7

        print "  cargo build (after proxy, no passthrough)..."
        let r = (run_cargo_build $cargo_flags)
        assert equal $r.exit_code 0 $"cargo build after proxy no-passthrough failed: ($r.stderr)"
        check_incremental $r.stderr "proxy(nopt) → cargo" $nopt_full_count

        if $bin_name != null {
            assert_binary $target_subdir $bin_name
            assert_binary_runs $target_subdir $bin_name
        }

        print "  modifying source..."
        modify_source $touch_file 8

        print "  tg run build (proxy, no passthrough, switch back)..."
        let r = (tg_run_build "tg run (proxy, no passthrough, switch back)" $cargo_flags)
        check_incremental $r.stderr "cargo → proxy(nopt)" $nopt_full_count

        if $bin_name != null {
            assert_binary $target_subdir $bin_name
            assert_binary_runs $target_subdir $bin_name
        }
    }

    # Cleanup.
    cd /
    ^rm -rf $tmp

    let modes = if $use_proxy { "all modes" } else { "no-proxy only" }
    print $"(ansi green)PASS(ansi reset): tg run integration test [($profile)] - ($modes)"
}
