#!/usr/bin/env nu

# Integration test: verify switching between plain cargo and tg run without full rebuild.
# Prerequisites: tangram server running, cargo/rustc installed.
#
# Usage:
#   nu run_integration.nu                                               # Test hello-workspace fixture, all modes.
#   nu run_integration.nu /path/to/project                              # Test an external project (no-proxy mode only).
#   nu run_integration.nu --proxy /path/to/project                      # Test with proxy mode for an external project.
#   nu run_integration.nu --bin cli --expected-output "Hello from a workspace!"
#   nu run_integration.nu --release                                     # Test release builds (no incremental compilation).

use std assert

# ── Assertion helpers ──────────────────────────────────────────────────

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

def assert_binary [profile: string, name: string] {
    let path = $"target/($profile)/($name)"
    assert ($path | path exists) $"binary not found: ($path)"
    let result = (^test -x $path | complete)
    assert equal $result.exit_code 0 $"binary is not executable: ($path)"
}

def assert_binary_runs [profile: string, name: string, args: list<string> = []] {
    let path = $"./target/($profile)/($name)"
    let output = (^$path ...$args | complete)
    assert equal $output.exit_code 0 $"binary ($name) ($args) exited with code ($output.exit_code)"
}

def assert_binary_output [profile: string, name: string, expected: string] {
    let path = $"./target/($profile)/($name)"
    let output = (^$path | complete)
    assert equal $output.exit_code 0 $"binary ($name) exited with code ($output.exit_code)"
    assert equal ($output.stdout | str trim) $expected "binary output mismatch"
}

def assert_target_structure [profile: string] {
    let deps_dir = $"target/($profile)/deps"
    assert ($deps_dir | path exists) $"deps directory not found: ($deps_dir)"
    let count = (ls $deps_dir | length)
    assert ($count > 0) $"deps directory is empty: ($deps_dir)"
}

def assert_no_externs [profile: string] {
    let externs = (glob $"target/($profile)/deps/*.externs")
    assert equal ($externs | length) 0 "unexpected .externs files found in deps/ (proxy was not expected)"
}

def assert_proxy_artifacts [profile: string] {
    let externs = (glob $"target/($profile)/deps/*.externs")
    assert (($externs | length) > 0) "no .externs files found in deps/ (expected proxy involvement)"
}

# tg run mode: run_proxy produces writable copies (not symlinks) so cargo
# can fingerprint and overwrite them on subsequent builds.
def assert_mixed_dep_types [profile: string] {
    let rlibs = (glob $"target/($profile)/deps/lib*.rlib")
    if ($rlibs | length) == 0 {
        print "  (no .rlib files in deps/ to check)"
        return
    }
    let symlinks = ($rlibs | where { |f| ($f | path type) == "symlink" })
    let regulars = ($rlibs | where { |f| ($f | path type) != "symlink" })
    print $"  deps/ has ($regulars | length) regular and ($symlinks | length) symlinked .rlib files"
    assert equal ($symlinks | length) 0 $"expected no symlinks in deps/ but found ($symlinks | length)"
    let non_writable = ($regulars | where { |f| (^test -w $f | complete).exit_code != 0 })
    assert equal ($non_writable | length) 0 $"expected all .rlib files to be writable but ($non_writable | length) are not"
}

def check_binary [profile: string, bin?, expected?, args: list<string> = [], --run] {
    if $bin == null { return }
    assert_binary $profile $bin
    if $expected != null {
        assert_binary_output $profile $bin $expected
    }
    if $run {
        assert_binary_runs $profile $bin $args
    }
}

def assert_incremental_dir [profile: string] {
    let inc_dir = $"target/($profile)/incremental"
    assert ($inc_dir | path exists) $"incremental directory not found: ($inc_dir)"
    let count = (ls $inc_dir | length)
    assert ($count > 0) $"incremental directory is empty: ($inc_dir)"
}

# ── Build helpers ──────────────────────────────────────────────────────

def parse_cargo_time [stderr: string]: nothing -> string {
    let finished = ($stderr | lines | where { |l| $l =~ "Finished" })
    if ($finished | length) > 0 {
        let line = ($finished | last)
        let match = ($line | parse --regex 'in (\d+[\d.]*\w+)')
        if ($match | length) > 0 { $match.0.capture0 } else { "?" }
    } else {
        "?"
    }
}

def print_timing [elapsed: duration, stderr: string] {
    let cargo_time = (parse_cargo_time $stderr)
    print $"  elapsed: ($elapsed) \(cargo: ($cargo_time)\)"
}

def run_cargo_build [flags: list<string>]: nothing -> record {
    let start = date now
    let r = (^cargo build ...$flags | complete)
    let elapsed = (date now) - $start
    print_timing $elapsed $r.stderr
    $r
}

def tg_run_build [label: string, flags: list<string>]: nothing -> record {
    let start = date now
    let r = (^tg run -b . -- build ...$flags | complete)
    let elapsed = (date now) - $start
    print_timing $elapsed $r.stderr
    if $r.exit_code != 0 {
        print $"  stderr: ($r.stderr)"
    }
    assert equal $r.exit_code 0 $"($label) failed: ($r.stderr)"
    $r
}

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
    --bin-args: list<string>  # Arguments to pass when verifying binary runs (e.g., ["--help"]).
    --expected-output: string  # Expected stdout from the binary.
    --touch: string      # Source file to modify for recompilation (default: auto-detected).
    --proxy              # Also test proxy mode (always on for hello-workspace).
    --release            # Use release builds instead of debug.
] {
    let rust_pkg = ($env.FILE_PWD | path dirname)
    let is_fixture = ($project == null)
    let source = if $is_fixture { $env.FILE_PWD | path join "hello-workspace" } else { $project }
    let use_proxy = $proxy or $is_fixture
    let profile = if $release { "release" } else { "debug" }
    let cargo_flags = if $release { ["--release"] } else { [] }
    let target_subdir = if $release { "release" } else { "debug" }
    let bin_check_args = $bin_args | default []

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
    check_binary $target_subdir $bin_name $expected_output

    print "  modifying source..."
    modify_source $touch_file 1

    print "  tg run build (no proxy)..."
    let r = (tg_run_build "tg run (no proxy)" $cargo_flags)
    check_incremental $r.stderr "cargo → tg run" $full_count --strict

    assert_target_structure $target_subdir
    assert_no_externs $target_subdir
    check_binary $target_subdir $bin_name $expected_output

    print "  modifying source..."
    modify_source $touch_file 2

    print "  cargo build (after tg run)..."
    let r = (run_cargo_build $cargo_flags)
    assert equal $r.exit_code 0 $"cargo build failed: ($r.stderr)"
    check_incremental $r.stderr "tg run → cargo" $full_count --strict

    assert_target_structure $target_subdir
    assert_no_externs $target_subdir
    check_binary $target_subdir $bin_name $expected_output

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
        check_binary $target_subdir $bin_name $expected_output
        if not $release { assert_incremental_dir $target_subdir }

        print "  modifying source..."
        modify_source $touch_file 3

        print "  tg run build (proxy+passthrough, incremental)..."
        let r = (tg_run_build "tg run (proxy+passthrough, incremental)" $cargo_flags)
        check_incremental $r.stderr "proxy → proxy" $proxy_full_count --strict

        check_binary $target_subdir $bin_name $expected_output
        if not $release { assert_incremental_dir $target_subdir }

        print "  modifying source..."
        modify_source $touch_file 4

        print "  cargo build (after proxy+passthrough)..."
        let r = (run_cargo_build $cargo_flags)
        assert equal $r.exit_code 0 $"cargo build after proxy failed: ($r.stderr)"
        check_incremental $r.stderr "proxy → cargo" $proxy_full_count

        check_binary $target_subdir $bin_name null $bin_check_args --run
        if not $release { assert_incremental_dir $target_subdir }

        print "  modifying source..."
        modify_source $touch_file 5

        print "  tg run build (proxy+passthrough, switch back)..."
        let r = (tg_run_build "tg run (proxy+passthrough, switch back)" $cargo_flags)
        check_incremental $r.stderr "cargo → proxy" $proxy_full_count

        check_binary $target_subdir $bin_name null $bin_check_args --run
        if not $release { assert_incremental_dir $target_subdir }
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
        check_binary $target_subdir $bin_name $expected_output

        print "  modifying source..."
        modify_source $touch_file 6

        print "  tg run build (proxy, no passthrough, incremental)..."
        let r = (tg_run_build "tg run (proxy, no passthrough, incremental)" $cargo_flags)
        check_incremental $r.stderr "proxy(nopt) → proxy(nopt)" $nopt_full_count --strict

        check_binary $target_subdir $bin_name

        print "  modifying source..."
        modify_source $touch_file 7

        print "  cargo build (after proxy, no passthrough)..."
        let r = (run_cargo_build $cargo_flags)
        assert equal $r.exit_code 0 $"cargo build after proxy no-passthrough failed: ($r.stderr)"
        check_incremental $r.stderr "proxy(nopt) → cargo" $nopt_full_count

        check_binary $target_subdir $bin_name null $bin_check_args --run

        print "  modifying source..."
        modify_source $touch_file 8

        print "  tg run build (proxy, no passthrough, switch back)..."
        let r = (tg_run_build "tg run (proxy, no passthrough, switch back)" $cargo_flags)
        check_incremental $r.stderr "cargo → proxy(nopt)" $nopt_full_count

        check_binary $target_subdir $bin_name null $bin_check_args --run
    }

    # Cleanup.
    cd /
    ^rm -rf $tmp

    let modes = if $use_proxy { "all modes" } else { "no-proxy only" }
    print $"(ansi green)PASS(ansi reset): tg run integration test [($profile)] - ($modes)"
}
