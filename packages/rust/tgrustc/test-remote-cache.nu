#!/usr/bin/env nu

# Test remote pull caching for tgrustc proxy builds.
#
# Verifies that a clean Tangram server can achieve cached build times (~40s)
# by pulling processes from a remote server, rather than rebuilding from scratch (~2m).
#
# Architecture: three servers, no cleaning.
#   1. Primary   — existing server at $TANGRAM_DIRECTORY (has cached processes)
#   2. Remote    — empty server that receives pushed processes (acts as shared cache)
#   3. Fresh     — empty server configured with Remote, simulates a clean machine
#
# The remote is populated with the direct children of the two process trees
# from the baseline build:
#   - Module eval children (~80): SDK, wrapping, codesign, etc.
#   - Proxy children (~773): individual rustc and build-script invocations.
# These are flat pushes (no --recursive), so transitive dependencies (like the
# GCC toolchain on Linux) are not included.
#
# Usage:
#   nu test-remote-cache.nu
#
#   # With overrides
#   TANGRAM_DIRECTORY=/path/to/tangram TANGRAM_WORKSPACE=/path/to/workspace nu test-remote-cache.nu
#
#   # Clean up after a Ctrl-C or failed run
#   nu test-remote-cache.nu --cleanup
#
# Environment variables:
#   TANGRAM_DIRECTORY  — path to primary tangram data directory (default: /opt/tangram)
#   TANGRAM_WORKSPACE  — path to tangram workspace to build (default: ~/code/tangram)
#   REMOTE_PORT        — port for the remote cache server (default: 8081)
#   FRESH_PORT         — port for the fresh server (default: 8082)

const REMOTE_DIR = "/tmp/tangram-remote-test/.tangram"
const FRESH_DIR = "/tmp/tangram-fresh-test/.tangram"
const PID_FILE = "/tmp/tangram-remote-test.pids"
const REMOTE_NAME = "default"

def main [
    --cleanup  # Only clean up leftover servers and temp directories, then exit.
] {
    if $cleanup {
        print "Cleaning up..."
        do_cleanup
        print "Done."
        return
    }

    let tangram_dir = ($env.TANGRAM_DIRECTORY? | default ($env.HOME + "/.tangram"))
    let workspace = ($env.TANGRAM_WORKSPACE? | default ($env.HOME + "/tangram"))
    let remote_port = ($env.REMOTE_PORT? | default "8081" | into int)
    let fresh_port = ($env.FRESH_PORT? | default "8082" | into int)

    print "Configuration:"
    print $"  Primary directory: ($tangram_dir)"
    print $"  Workspace: ($workspace)"
    print $"  Remote server: http://localhost:($remote_port) \(($REMOTE_DIR))"
    print $"  Fresh server:  http://localhost:($fresh_port) \(($FRESH_DIR))"
    print ""

    # Validate prerequisites.
    if not ($tangram_dir | path exists) {
        error make { msg: $"Primary tangram directory ($tangram_dir) does not exist." }
    }
    if not ($workspace | path exists) {
        error make { msg: $"Workspace ($workspace) does not exist." }
    }

    # Always start clean — kill leftover processes and remove stale directories.
    do_cleanup

    # Step 1: Start the remote cache server.
    print "Step 1: Starting remote cache server..."
    mkdir $REMOTE_DIR
    let remote_pid = (start_server $REMOTE_DIR $remote_port)
    save_pid $remote_pid
    print $"  Remote server started \(PID ($remote_pid))."

    # Step 2: Run an initial build on the primary server to populate the cache.
    # Split into build + cache + run as a workaround for tg run -b not caching
    # artifacts referenced in command args before executing.
    print "Step 2: Running baseline build on primary server..."
    let baseline_log = "/tmp/tgrustc-remote-baseline.log"
    bash -c $"cd ($workspace) && cargo clean" o+e>| ignore
    let baseline_start = (date now)

    print "  Evaluating module..."
    let baseline_eval_start = (date now)
    let baseline_build = (bash -c $"cd ($workspace) && tangram build .#run 2>/tmp/tgrustc-baseline-eval.log" | complete)
    if $baseline_build.exit_code != 0 {
        print "  Module evaluation failed. Stderr:"
        print (open /tmp/tgrustc-baseline-eval.log)
        error make { msg: "tangram build failed on primary server" }
    }
    let run_cmd = ($baseline_build.stdout | str trim | lines | last)
    let baseline_eval_elapsed = (date now) - $baseline_eval_start
    print $"  Built run command: ($run_cmd) \(($baseline_eval_elapsed))"

    # Extract the module eval process ID from the stderr log.
    let eval_process = (open /tmp/tgrustc-baseline-eval.log | lines | where { |l| $l starts-with "info pcs_" } | first | split row " " | get 1)
    print $"  Module eval process: ($eval_process)"

    cache_command_artifacts $run_cmd

    print "  Running cargo build..."
    let baseline_cargo_start = (date now)
    bash -c $"cd ($workspace) && tangram run ($run_cmd) -- build 2>&1 | tee ($baseline_log)"
    let baseline_cargo_elapsed = (date now) - $baseline_cargo_start
    let baseline_elapsed = (date now) - $baseline_start
    print $"  Cargo build: ($baseline_cargo_elapsed), total baseline: ($baseline_elapsed)"

    # Step 3: Find the most recent run process with proxy children.
    print "Step 3: Finding run process in primary database..."
    let run_process = (find_run_process $tangram_dir)
    let child_count = (count_rustc_children $tangram_dir $run_process)
    print $"  Found process ($run_process) with ($child_count) rustc children."

    # Step 4: Collect processes to push.
    print "Step 4: Collecting processes to push..."

    # Module eval's process children: SDK, wrapping, codesign, etc.
    # These are the cache entries the fresh server needs so it does not have to
    # rebuild the SDK and toolchain from scratch.
    # NOTE: `tangram children` returns the command's ARTIFACT children (dir_/fil_),
    # not the process's child PROCESSES (pcs_). We need the process children
    # from the process_children database table.
    let eval_children = (run_sql $tangram_dir $"SELECT child FROM process_children WHERE process = '($eval_process)'"
        | lines | where { |l| not ($l | is-empty) })
    print $"  Module eval process children: ($eval_children | length)"

    # Proxy direct children: individual rustc and build-script invocations.
    let proxy_children = (find_proxy_children $tangram_dir $run_process)
    print $"  Proxy children: ($proxy_children | length)"

    # Step 5: Push all processes to the remote.
    # Flat push with --outputs only (no --recursive), so transitive dependencies
    # like the GCC toolchain on Linux are not included.
    # Batched to avoid exceeding the HTTP/2 header size limit (16KB).
    print "Step 5: Pushing processes to remote server..."
    tangram remote put $REMOTE_NAME $"http://localhost:($remote_port)"

    let all_processes = ($eval_children | append $proxy_children)
    let batch_size = 100
    let batches = ($all_processes | chunks $batch_size)
    for batch in $batches {
        tangram push --eager --outputs $"--remote=($REMOTE_NAME)" ...$batch
    }
    print $"  Pushed ($all_processes | length) processes in ($batches | length) batches."

    # Clean up the remote on the primary server.
    tangram remote delete $REMOTE_NAME

    # Step 6: Start the fresh server with the remote configured.
    print "Step 6: Starting fresh server..."
    mkdir $FRESH_DIR
    let fresh_pid = (start_server $FRESH_DIR $fresh_port)
    save_pid $fresh_pid
    sleep 2sec

    # Configure the remote on the fresh server.
    with-env { TANGRAM_URL: $"http://localhost:($fresh_port)" } {
        tangram remote put $REMOTE_NAME $"http://localhost:($remote_port)"
    }
    print $"  Fresh server started \(PID ($fresh_pid)) with remote configured."

    # Step 7: Rebuild from the fresh server.
    # The module JS re-evaluates, but its child builds (SDK, wrapping, etc.)
    # should be cache hits from the remote. The proxy processes should also
    # be cache hits.
    print "Step 7: Rebuilding from fresh server (should pull from remote)..."
    let rebuild_log = "/tmp/tgrustc-remote-rebuild.log"
    bash -c $"cd ($workspace) && cargo clean" o+e>| ignore
    let rebuild_start = (date now)

    print "  Evaluating module..."
    let eval_start = (date now)
    let fresh_build = (bash -c $"cd ($workspace) && TANGRAM_URL=http://localhost:($fresh_port) tangram build .#run 2>/tmp/tgrustc-fresh-eval.log" | complete)
    if $fresh_build.exit_code != 0 {
        print "  Module evaluation failed. Stderr:"
        print (open /tmp/tgrustc-fresh-eval.log)
        error make { msg: "tangram build failed on fresh server" }
    }
    let fresh_cmd = ($fresh_build.stdout | str trim | lines | last)
    let eval_elapsed = (date now) - $eval_start
    print $"  Built run command: ($fresh_cmd) \(($eval_elapsed))"

    # Cache artifacts referenced by the command (workaround for tg run -b bug).
    with-env { TANGRAM_URL: $"http://localhost:($fresh_port)" } { cache_command_artifacts $fresh_cmd }

    # Run the build. This is where the proxy processes should cache-hit.
    print "  Running cargo build..."
    let cargo_start = (date now)
    bash -c $"cd ($workspace) && TANGRAM_URL=http://localhost:($fresh_port) TGRUSTC_TRACING=info tangram run ($fresh_cmd) -- build 2>&1 | tee ($rebuild_log)"
    let cargo_elapsed = (date now) - $cargo_start
    let rebuild_elapsed = (date now) - $rebuild_start
    print $"  Cargo build: ($cargo_elapsed), total rebuild: ($rebuild_elapsed)"

    # Step 8: Verify cache hits on the fresh server.
    # Count race outcomes from the server tracing log. When the remote wins
    # the race, process_children entries are not created, so we rely on
    # the tracing log instead of the database.
    print ""
    print "Step 8: Verifying cache state..."
    let log_file = $"/tmp/tangram-serve-($fresh_port).log"
    let remote_wins = if ($log_file | path exists) {
        open $log_file | lines | where { |l| $l =~ "remote won the race" } | length
    } else { 0 }
    let local_wins = if ($log_file | path exists) {
        open $log_file | lines | where { |l| $l =~ "local won the race" } | length
    } else { 0 }
    let remote_misses = if ($log_file | path exists) {
        open $log_file | lines | where { |l| $l =~ "remote failed or returned None" } | length
    } else { 0 }
    print $"  Remote cache hits: ($remote_wins)"
    print $"  Local wins:        ($local_wins)"
    print $"  Remote misses:     ($remote_misses)"

    # Step 9: Proxy timing breakdown.
    # Parse proxy_complete tracing entries to separate cached (remote hit)
    # time from uncached (local build) time.
    if ($rebuild_log | path exists) {
        let proxy_lines = (open $rebuild_log | lines | where { |l| $l =~ "proxy_complete" })
        let cached_times = ($proxy_lines | where { |l| $l =~ "cached=true" }
            | each { |l| $l | parse --regex 'elapsed_ms=(\d+)' | get 0?.capture0? | default "0" | into int })
        let cached_ms = if ($cached_times | is-empty) { 0 } else { $cached_times | math sum }
        let uncached_times = ($proxy_lines | where { |l| $l =~ "cached=false" }
            | each { |l| $l | parse --regex 'elapsed_ms=(\d+)' | get 0?.capture0? | default "0" | into int })
        let uncached_ms = if ($uncached_times | is-empty) { 0 } else { $uncached_times | math sum }
        let cached_count = ($proxy_lines | where { |l| $l =~ "cached=true" } | length)
        let uncached_count = ($proxy_lines | where { |l| $l =~ "cached=false" } | length)
        let total_proxy_ms = $cached_ms + $uncached_ms
        let cargo_overhead_ms = (($cargo_elapsed | into int) / 1_000_000) - $total_proxy_ms
        print $"  Proxy invocations: ($cached_count) cached + ($uncached_count) uncached"
        print $"  Proxy time:  cached ($cached_ms)ms, uncached ($uncached_ms)ms"
        print $"  Cargo overhead: ($cargo_overhead_ms)ms \(linking, fingerprinting, etc.)"
    }

    # Cycle detection timing from the server log.
    let log_file = $"/tmp/tangram-serve-($fresh_port).log"
    if ($log_file | path exists) {
        let cycle_times = (open $log_file | lines
            | where { |l| $l =~ "cycle_detection" }
            | each { |l| $l | parse --regex 'cycle_ms=(\d+)' | get 0?.capture0? | default "0" | into int })
        if not ($cycle_times | is-empty) {
            let cycle_total = ($cycle_times | math sum)
            let cycle_count = ($cycle_times | length)
            let cycle_avg = $cycle_total / $cycle_count
            print $"  Cycle detection: ($cycle_count) checks, ($cycle_total)ms total, ($cycle_avg)ms avg"
        }
    }

    # Step 10: Report results.
    print ""
    print "========================================"
    print "  Results"
    print "========================================"
    print ""
    print "  Baseline \(primary server, uncached cargo):"
    print $"    Module eval:    ($baseline_eval_elapsed)"
    print $"    Cargo build:    ($baseline_cargo_elapsed)"
    print $"    Total:          ($baseline_elapsed)"
    print ""
    print "  Remote pull \(fresh server):"
    print $"    Module eval:    ($eval_elapsed)"
    print $"    Cargo build:    ($cargo_elapsed)"
    print $"    Total:          ($rebuild_elapsed)"
    print ""
    if $baseline_cargo_elapsed > 0sec and $cargo_elapsed > 0sec {
        let cargo_speedup = (($baseline_cargo_elapsed | into int) / ($cargo_elapsed | into int))
        let total_speedup = (($baseline_elapsed | into int) / ($rebuild_elapsed | into int))
        print $"  Cargo speedup:    ($cargo_speedup)x"
        print $"  Total speedup:    ($total_speedup)x"
        print ""
    }
    print $"  Remote cache hits: ($remote_wins), local wins: ($local_wins), remote misses: ($remote_misses)"
    print "========================================"

    # Step 10: Cleanup.
    print ""
    print "Step 10: Cleaning up..."
    do_cleanup
    print "  Done."
}

# Checkout all artifact children of a command. Workaround for tg run -b not
# checking out artifacts referenced in command args before executing.
# Checked out sequentially to avoid a race condition when pulling multiple
# artifacts from a remote concurrently.
def cache_command_artifacts [cmd_id: string] {
    let artifacts = (tangram children $cmd_id | from json)
    for artifact in $artifacts {
        tangram checkout $artifact
    }
}

# Run a SQL query against a tangram database and return the trimmed result.
def run_sql [tangram_dir: string, query: string]: nothing -> string {
    sqlite3 $"($tangram_dir)/database" $query | str trim
}

# Start a tangram server in the background. Returns the PID.
def start_server [dir: string, port: int, --tracing: string, --config-file: string]: nothing -> int {
    let url = $"http://localhost:($port)"
    let log_file = $"/tmp/tangram-serve-($port).log"
    let tracing_flag = if $tracing != null { $" --tracing '($tracing)'" } else { "" }
    let config_flag = if $config_file != null { $" -c '($config_file)'" } else { "" }
    let pid = (bash -c $"tangram serve -d ($dir) -u ($url)($tracing_flag)($config_flag) > ($log_file) 2>&1 & echo $!" | str trim | into int)
    # Wait briefly for the server to start.
    sleep 2sec
    $pid
}

# Record a server PID so cleanup can find it after Ctrl-C.
def save_pid [pid: int] {
    $"($pid)\n" | save --append $PID_FILE
}

# Kill a server process by PID.
def kill_server [pid: int] {
    try {
        kill $pid
    } catch {
        # The process may have already exited.
    }
}

# Find the most recent run process with ~697 rustc children.
def find_run_process [tangram_dir: string]: nothing -> string {
    let result = (run_sql $tangram_dir "SELECT process FROM process_children WHERE json_extract(options, '$.name') LIKE 'rustc %' GROUP BY process ORDER BY rowid DESC LIMIT 1")
    if ($result | is-empty) {
        error make { msg: "No run process found with rustc children." }
    }
    $result
}

# Count the number of rustc children for a given process.
def count_rustc_children [tangram_dir: string, process_id: string]: nothing -> int {
    run_sql $tangram_dir $"SELECT count\(*) FROM process_children WHERE process = '($process_id)' AND json_extract\(options, '$.name') LIKE 'rustc %'" | into int
}

# Find all rustc and build-script child processes for a given run process.
# These are leaf processes with no children of their own.
def find_proxy_children [tangram_dir: string, run_process: string]: nothing -> list<string> {
    run_sql $tangram_dir $"SELECT child FROM process_children WHERE process = '($run_process)' AND \(json_extract\(options, '$.name') LIKE 'rustc %' OR json_extract\(options, '$.name') LIKE 'build-script %')"
        | lines
        | where { |line| not ($line | is-empty) }
}

# Clean up all test state: kill servers (by PID file and by process name),
# remove temp directories, and remove the test remote from the primary server.
def do_cleanup [] {
    # Kill servers recorded in the PID file (handles Ctrl-C recovery).
    if ($PID_FILE | path exists) {
        let pids = (open $PID_FILE | lines | where { |l| not ($l | is-empty) })
        for pid_str in $pids {
            try {
                kill ($pid_str | into int)
            } catch { }
        }
        rm -f $PID_FILE
    }

    # Also kill by process name in case the PID file was lost or stale.
    bash -c $"pkill -f 'tangram serve -d ($REMOTE_DIR)' 2>/dev/null || true" o+e>| ignore
    bash -c $"pkill -f 'tangram serve -d ($FRESH_DIR)' 2>/dev/null || true" o+e>| ignore

    # Wait briefly for processes to exit before removing their directories.
    sleep 500ms

    # Remove temp directories. Use chmod to fix permissions that the tangram
    # server may have set on cached artifacts. Remove parent dirs too.
    let remote_parent = ($REMOTE_DIR | path dirname)
    let fresh_parent = ($FRESH_DIR | path dirname)
    if ($remote_parent | path exists) { chmod -R +w $remote_parent; rm -rf $remote_parent }
    if ($fresh_parent | path exists) { chmod -R +w $fresh_parent; rm -rf $fresh_parent }

    # Remove test remote from primary server if it exists.
    try { tangram remote delete $REMOTE_NAME } catch { }
}
