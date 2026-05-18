#!/usr/bin/env nu

# Test remote pull caching for tgrustc-next.
#
# Verifies that a fresh tangram server can cache-hit the rustc invocations
# from a tgrustc-next build by pulling cached processes from a remote server.
#
# Architecture: three servers, no cleaning.
#   1. Primary — existing server at $TANGRAM_DIRECTORY (has cached processes).
#   2. Remote  — empty server that receives pushed processes.
#   3. Fresh   — empty server configured with Remote, simulates a clean machine.
#
# The whole process tree of the baseline build is pushed flat (no --recursive),
# so transitive input artifacts (toolchain checkouts, etc.) are not included.
# Cached processes still serve their outputs without needing their inputs.
#
# Usage:
#   nu test-remote-cache.nu
#   nu test-remote-cache.nu --cleanup
#
# Environment variables:
#   TANGRAM_DIRECTORY — primary tangram data directory (default: ~/.tangram).
#   PACKAGES_DIR      — packages/packages/rust directory containing tangram.ts.
#                       (default: ~/packages/packages/rust).
#   REMOTE_PORT       — port for the remote cache server (default: 8081).
#   FRESH_PORT        — port for the fresh server (default: 8082).

const REMOTE_DIR = "/tmp/tangram-remote-test-next/.tangram"
const FRESH_DIR = "/tmp/tangram-fresh-test-next/.tangram"
const PID_FILE = "/tmp/tangram-remote-test-next.pids"
const REMOTE_NAME = "default"
const TARGET = ".#testProxyNextProcMacroDeps"

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
    let packages_dir = ($env.PACKAGES_DIR? | default ($env.HOME + "/packages/packages/rust"))
    let remote_port = ($env.REMOTE_PORT? | default "8081" | into int)
    let fresh_port = ($env.FRESH_PORT? | default "8082" | into int)

    print "Configuration:"
    print $"  Primary directory: ($tangram_dir)"
    print $"  Packages dir:      ($packages_dir)"
    print $"  Remote server:     http://localhost:($remote_port) \(($REMOTE_DIR))"
    print $"  Fresh server:      http://localhost:($fresh_port) \(($FRESH_DIR))"
    print $"  Target:            ($TARGET)"
    print ""

    if not ($tangram_dir | path exists) {
        error make { msg: $"Primary tangram directory ($tangram_dir) does not exist." }
    }
    if not ($packages_dir | path exists) {
        error make { msg: $"Packages directory ($packages_dir) does not exist." }
    }

    # Always start clean — kill leftover processes and remove stale directories.
    do_cleanup

    # Step 1: Start the remote cache server.
    print "Step 1: Starting remote cache server..."
    mkdir $REMOTE_DIR
    let remote_pid = (start_server $REMOTE_DIR $remote_port)
    save_pid $remote_pid
    print $"  Remote server started \(PID ($remote_pid))."

    # Step 2: Run the baseline build on the primary server.
    # The test fixture invokes cargo internally, so a single `tangram build`
    # call produces the whole process tree we want to cache.
    print "Step 2: Running baseline build on primary server..."
    let baseline_log = "/tmp/tgnext-baseline-eval.log"
    let baseline_start = (date now)
    let baseline_build = (bash -c $"cd ($packages_dir) && tangram build ($TARGET) 2>($baseline_log)" | complete)
    let baseline_elapsed = (date now) - $baseline_start
    if $baseline_build.exit_code != 0 {
        print "  Baseline build failed. Stderr:"
        print (open $baseline_log)
        error make { msg: "baseline build failed on primary server" }
    }
    print $"  Baseline build: ($baseline_elapsed)"

    # Extract the top-level test process id from the stderr log.
    let top_process = (open $baseline_log | lines
        | where { |l| $l starts-with "info pcs_" }
        | first
        | split row " " | get 1)
    print $"  Top process: ($top_process)"

    # Step 3: Collect every descendant of the top process via a recursive CTE.
    # Flat push semantics let cached processes serve their outputs without
    # fetching their input artifacts, so the toolchain is not pulled.
    print "Step 3: Collecting process tree..."
    let pcs_list = (collect_tree $tangram_dir $top_process)
    let rustc_count = (count_rustc_in_tree $tangram_dir $top_process)
    print $"  Tree size: ($pcs_list | length) processes \(($rustc_count) rustc invocations)."

    if $rustc_count < 1 {
        error make { msg: "no rustc processes found in tree; tgrustc-next may not have spawned any sandbox processes" }
    }

    # Step 4: Push every process to the remote, batched to stay under the
    # HTTP/2 header size limit (16KB).
    print "Step 4: Pushing processes to remote server..."
    tangram remote put $REMOTE_NAME $"http://localhost:($remote_port)"
    let batch_size = 100
    let batches = ($pcs_list | chunks $batch_size)
    for batch in $batches {
        tangram push --eager --commands --outputs $"--remote=($REMOTE_NAME)" ...$batch
    }
    print $"  Pushed ($pcs_list | length) processes \(commands + outputs) in ($batches | length) batches."
    tangram remote delete $REMOTE_NAME

    # Step 5: Start the fresh server with the remote configured.
    print "Step 5: Starting fresh server..."
    mkdir $FRESH_DIR
    let fresh_pid = (start_server $FRESH_DIR $fresh_port)
    save_pid $fresh_pid
    sleep 2sec
    with-env { TANGRAM_URL: $"http://localhost:($fresh_port)" } {
        tangram remote put $REMOTE_NAME $"http://localhost:($remote_port)"
    }
    print $"  Fresh server started \(PID ($fresh_pid)) with remote configured."

    # Step 6: Rebuild on the fresh server. Most processes should be cache hits
    # served from the remote.
    print "Step 6: Rebuilding on fresh server..."
    let rebuild_log = "/tmp/tgnext-fresh-eval.log"
    let rebuild_start = (date now)
    let fresh_run = (bash -c $"cd ($packages_dir) && TANGRAM_URL=http://localhost:($fresh_port) tangram build ($TARGET) 2>&1 | tee ($rebuild_log); exit ${PIPESTATUS[0]}" | complete)
    let rebuild_elapsed = (date now) - $rebuild_start
    print $"  Rebuild: ($rebuild_elapsed)"
    if $fresh_run.exit_code != 0 {
        print $"  FRESH BUILD FAILED with exit code ($fresh_run.exit_code)."
        print $"  Fresh server preserved at ($FRESH_DIR) for inspection."
        print $"  Server log: /tmp/tangram-serve-($fresh_port).log"
        print $"  Build log:  ($rebuild_log)"
        error make { msg: "fresh server build failed; cleanup skipped so the fresh server can be inspected" }
    }

    # Step 7: Verify cache hits by querying the fresh server's process_children
    # table. Each row's `cached` column is 1 when the spawn was served from
    # cache (local or remote) rather than freshly executed. The fresh server
    # only spawns processes that did not cache-hit at a higher level, so a
    # passing run looks like "N / N cached" with N small (the test process
    # short-circuits the cargo.build subtree).
    print ""
    print "Step 7: Verifying cache state on fresh server..."
    let fresh_top = (open $rebuild_log | lines
        | where { |l| $l starts-with "info pcs_" }
        | first
        | split row " " | get 1)
    let fresh_total = (collect_tree $FRESH_DIR $fresh_top | length)
    let fresh_cached = (count_cached_in_tree $FRESH_DIR $fresh_top)
    print $"  Fresh top: ($fresh_top)"
    print $"  Processes spawned by fresh server: ($fresh_total)"
    print $"  Of those, cache hits:              ($fresh_cached)"
    if $fresh_total != $fresh_cached {
        print $"  WARNING: ($fresh_total - $fresh_cached) processes were not cache hits."
    }

    # Step 8: Report.
    print ""
    print "========================================"
    print "  Results"
    print "========================================"
    print ""
    print "  Baseline \(primary):"
    print $"    Total: ($baseline_elapsed)"
    print ""
    print "  Remote pull \(fresh):"
    print $"    Total: ($rebuild_elapsed)"
    print ""
    if $baseline_elapsed > 0sec and $rebuild_elapsed > 0sec {
        let speedup = (($baseline_elapsed | into int) / ($rebuild_elapsed | into int))
        print $"  Speedup: ($speedup)x"
        print ""
    }
    print $"  Fresh server: ($fresh_cached) / ($fresh_total) processes cache-hit."
    print "========================================"

    print ""
    print "Cleaning up..."
    do_cleanup
    print "  Done."
}

# Collect every descendant of root via a recursive CTE on process_children.
def collect_tree [tangram_dir: string, root: string]: nothing -> list<string> {
    let query = $"WITH RECURSIVE tree AS \(
        SELECT child FROM process_children WHERE process = '($root)'
        UNION
        SELECT pc.child FROM process_children pc JOIN tree t ON pc.process = t.child
    ) SELECT child FROM tree"
    sqlite3 $"($tangram_dir)/processes" $query
        | lines
        | where { |l| not ($l | is-empty) }
}

# Count the number of `rustc *` processes in root's descendant tree. These are
# the tgrustc-next sandbox invocations and are the primary cache hits we want.
def count_rustc_in_tree [tangram_dir: string, root: string]: nothing -> int {
    let query = $"WITH RECURSIVE tree AS \(
        SELECT child, json_extract\(options, '$.name') AS name, cached FROM process_children WHERE process = '($root)'
        UNION
        SELECT pc.child, json_extract\(pc.options, '$.name'), pc.cached FROM process_children pc JOIN tree t ON pc.process = t.child
    ) SELECT count\(*) FROM tree WHERE name LIKE 'rustc %'"
    sqlite3 $"($tangram_dir)/processes" $query | str trim | into int
}

# Count all descendants marked as served from cache.
def count_cached_in_tree [tangram_dir: string, root: string]: nothing -> int {
    let query = $"WITH RECURSIVE tree AS \(
        SELECT child, cached FROM process_children WHERE process = '($root)'
        UNION
        SELECT pc.child, pc.cached FROM process_children pc JOIN tree t ON pc.process = t.child
    ) SELECT count\(*) FROM tree WHERE cached = 1"
    sqlite3 $"($tangram_dir)/processes" $query | str trim | into int
}

# Start a tangram server in the background. Returns the PID.
def start_server [dir: string, port: int]: nothing -> int {
    let url = $"http://localhost:($port)"
    let log_file = $"/tmp/tangram-serve-($port).log"
    let pid = (bash -c $"tangram serve -d ($dir) -u ($url) > ($log_file) 2>&1 & echo $!"
        | str trim | into int)
    sleep 2sec
    $pid
}

# Record a server PID so cleanup can find it after Ctrl-C.
def save_pid [pid: int] {
    $"($pid)\n" | save --append $PID_FILE
}

# Clean up all test state: kill servers, remove temp directories, and drop the
# test remote from the primary server.
def do_cleanup [] {
    if ($PID_FILE | path exists) {
        let pids = (open $PID_FILE | lines | where { |l| not ($l | is-empty) })
        for pid_str in $pids {
            try { kill ($pid_str | into int) } catch { }
        }
        rm -f $PID_FILE
    }

    bash -c $"pkill -f 'tangram serve -d ($REMOTE_DIR)' 2>/dev/null || true" o+e>| ignore
    bash -c $"pkill -f 'tangram serve -d ($FRESH_DIR)' 2>/dev/null || true" o+e>| ignore

    sleep 500ms

    let remote_parent = ($REMOTE_DIR | path dirname)
    let fresh_parent = ($FRESH_DIR | path dirname)
    if ($remote_parent | path exists) { chmod -R u+rwX $remote_parent; rm -rf $remote_parent }
    if ($fresh_parent | path exists) { chmod -R u+rwX $fresh_parent; rm -rf $fresh_parent }

    bash -c $"tangram remote delete ($REMOTE_NAME) 2>/dev/null || true" o+e>| ignore
}
