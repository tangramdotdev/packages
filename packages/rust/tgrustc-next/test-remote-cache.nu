#!/usr/bin/env nu

# Test remote pull caching for tgrustc-next in the `tg run` (host cargo) flow.
#
# Cargo runs on the host with `RUSTC_WRAPPER=tgrustc-next`. Workspace members
# and build scripts compile via host rustc (passthrough); vendored crates spawn
# sandbox tangram processes that are content-addressed and should cache-hit
# across machines.
#
# Architecture: three servers, no cleaning.
#   1. Primary — existing server at $TANGRAM_DIRECTORY (has cached processes).
#   2. Remote  — empty server that receives pushed processes.
#   3. Fresh   — empty server configured with Remote, simulates a clean machine.
#
# The script tracks orphan rustc processes (those spawned by host cargo with
# no tangram-tree parent) by recording start/end timestamps and filtering the
# `processes` table on `created_at`.
#
# Usage:
#   nu test-remote-cache.nu
#   nu test-remote-cache.nu --cleanup
#
# Environment variables:
#   TANGRAM_DIRECTORY — primary tangram data directory (default: ~/.tangram).
#   PACKAGES_DIR      — packages/packages/rust directory containing tangram.ts.
#                       (default: ~/packages/packages/rust).
#   WORKSPACE_DIR     — host workspace where cargo runs (default: /tmp/tgnext-workspace).
#                       Must be writable; this script populates it.
#   REMOTE_PORT       — port for the remote cache server (default: 8081).
#   FRESH_PORT        — port for the fresh server (default: 8082).

const REMOTE_DIR = "/tmp/tangram-remote-test-next/.tangram"
const FRESH_DIR = "/tmp/tangram-fresh-test-next/.tangram"
const PID_FILE = "/tmp/tangram-remote-test-next.pids"
const REMOTE_NAME = "default"
const TARGET = ".#runProxyNextProcMacroDeps"

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
    let workspace_dir = ($env.WORKSPACE_DIR? | default "/tmp/tgnext-workspace")
    let fixture_src = $"($packages_dir)/tests/hello-proc-macro-deps"
    let remote_port = ($env.REMOTE_PORT? | default "8081" | into int)
    let fresh_port = ($env.FRESH_PORT? | default "8082" | into int)

    print "Configuration:"
    print $"  Primary directory: ($tangram_dir)"
    print $"  Packages dir:      ($packages_dir)"
    print $"  Workspace dir:     ($workspace_dir)"
    print $"  Remote server:     http://localhost:($remote_port) \(($REMOTE_DIR))"
    print $"  Fresh server:      http://localhost:($fresh_port) \(($FRESH_DIR))"
    print $"  Target:            ($TARGET)"
    print ""

    if not ($tangram_dir | path exists) {
        error make { msg: $"Primary tangram directory ($tangram_dir) does not exist." }
    }
    if not ($fixture_src | path exists) {
        error make { msg: $"Fixture source ($fixture_src) does not exist." }
    }

    do_cleanup
    ^rm -rf $workspace_dir
    ^cp -r $fixture_src $workspace_dir

    # Step 1: Start the remote cache server.
    print "Step 1: Starting remote cache server..."
    mkdir $REMOTE_DIR
    let remote_pid = (start_server $REMOTE_DIR $remote_port)
    save_pid $remote_pid
    print $"  Remote server started \(PID ($remote_pid))."

    # Step 2: Evaluate the cargo.run command on the primary server.
    print "Step 2: Building run command on primary..."
    let eval_log = "/tmp/tgnext-baseline-eval.log"
    let eval = (bash -c $"cd ($packages_dir) && tangram build ($TARGET) 2>($eval_log)" | complete)
    if $eval.exit_code != 0 {
        print (open $eval_log)
        error make { msg: "tangram build of run command failed" }
    }
    let cmd_id = ($eval.stdout | str trim | lines | last)
    let eval_process = (open $eval_log | lines
        | where { |l| $l starts-with "info pcs_" }
        | first
        | split row " " | get 1)
    print $"  Run command: ($cmd_id)"
    print $"  Eval process: ($eval_process)"

    # Step 3: Run cargo build on primary. Track timestamp so orphan rustc
    # processes spawned by the wrapper can be located later.
    print "Step 3: Running baseline build..."
    let baseline_log = "/tmp/tgnext-baseline-build.log"
    let baseline_start_ts = (date now | format date "%s" | into int)
    let baseline_start = (date now)
    bash -c $"cd ($workspace_dir) && tangram run ($cmd_id) -- build 2>&1 | tee ($baseline_log)" o+e>| ignore
    let baseline_elapsed = (date now) - $baseline_start
    let baseline_end_ts = (date now | format date "%s" | into int)
    print $"  Baseline cargo build: ($baseline_elapsed)"

    # Step 4: Find sandbox rustc processes spawned during the baseline window.
    print "Step 4: Locating sandbox spawns..."
    let orphan_rustc = (find_orphan_rustc $tangram_dir $baseline_start_ts $baseline_end_ts)
    let eval_tree = (collect_tree $tangram_dir $eval_process)
    let all_processes = ($orphan_rustc | append $eval_tree | append [$eval_process] | uniq)
    print $"  Orphan rustc spawns: ($orphan_rustc | length)"
    print $"  Eval tree size:      ($eval_tree | length)"
    print $"  Total to push:       ($all_processes | length)"

    if ($orphan_rustc | length) < 1 {
        error make { msg: "no orphan rustc spawns found in time window; tgrustc-next may not have routed to the sandbox" }
    }

    # Step 5: Push to remote in batches.
    print "Step 5: Pushing processes to remote..."
    tangram remote put $REMOTE_NAME $"http://localhost:($remote_port)"
    let batch_size = 100
    let batches = ($all_processes | chunks $batch_size)
    for batch in $batches {
        tangram push --eager --commands --outputs $"--remote=($REMOTE_NAME)" ...$batch
    }
    print $"  Pushed ($all_processes | length) processes in ($batches | length) batches."
    bash -c $"tangram remote delete ($REMOTE_NAME) 2>/dev/null || true" o+e>| ignore

    # Step 6: Start fresh server.
    print "Step 6: Starting fresh server..."
    mkdir $FRESH_DIR
    let fresh_pid = (start_server $FRESH_DIR $fresh_port)
    save_pid $fresh_pid
    sleep 2sec
    with-env { TANGRAM_URL: $"http://localhost:($fresh_port)" } {
        tangram remote put $REMOTE_NAME $"http://localhost:($remote_port)"
    }
    print $"  Fresh server started \(PID ($fresh_pid)) with remote configured."

    # Step 7: Rebuild on fresh server. cargo clean clears host target/ so cargo
    # actually re-invokes rustc for every crate; cache hits happen at the
    # tangram-process level inside the wrapper.
    print "Step 7: Cleaning host target/ and rebuilding on fresh server..."
    bash -c $"cd ($workspace_dir) && cargo clean" o+e>| ignore
    let rebuild_eval_log = "/tmp/tgnext-fresh-eval.log"
    let fresh_eval = (bash -c $"cd ($packages_dir) && TANGRAM_URL=http://localhost:($fresh_port) tangram build ($TARGET) 2>($rebuild_eval_log)" | complete)
    if $fresh_eval.exit_code != 0 {
        print (open $rebuild_eval_log)
        error make { msg: "fresh tangram build of run command failed" }
    }
    let fresh_cmd_id = ($fresh_eval.stdout | str trim | lines | last)
    let rebuild_log = "/tmp/tgnext-fresh-build.log"
    let rebuild_start_ts = (date now | format date "%s" | into int)
    let rebuild_start = (date now)
    let fresh_run = (bash -c $"cd ($workspace_dir) && TANGRAM_URL=http://localhost:($fresh_port) tangram run ($fresh_cmd_id) -- build 2>&1 | tee ($rebuild_log); exit ${PIPESTATUS[0]}" | complete)
    let rebuild_elapsed = (date now) - $rebuild_start
    let rebuild_end_ts = (date now | format date "%s" | into int)
    if $fresh_run.exit_code != 0 {
        print $"  FRESH BUILD FAILED with exit code ($fresh_run.exit_code)."
        print $"  Fresh server preserved at ($FRESH_DIR) for inspection."
        error make { msg: "fresh server build failed; cleanup skipped" }
    }
    print $"  Fresh cargo build: ($rebuild_elapsed)"

    # Step 8: Count cache hits on the fresh server.
    # An orphan process is a cache hit if its row exists in the fresh DB but
    # was originally created (`created_at`) before this rebuild started — i.e.
    # the process was pulled from the remote rather than freshly spawned.
    print ""
    print "Step 8: Verifying cache hits on fresh server..."
    let fresh_orphans = (find_orphan_rustc $FRESH_DIR $rebuild_start_ts $rebuild_end_ts)
    let fresh_cached = (count_pre_existing $FRESH_DIR $fresh_orphans $rebuild_start_ts)
    let fresh_total = ($fresh_orphans | length)
    print $"  Orphan rustc on fresh: ($fresh_total) total, ($fresh_cached) served from remote cache."

    # Step 9: Report.
    print ""
    print "========================================"
    print "  Results"
    print "========================================"
    print ""
    print "  Baseline (primary, host cargo + sandbox rustc):"
    print $"    cargo build: ($baseline_elapsed)"
    print ""
    print "  Remote pull (fresh, host cargo + sandbox rustc):"
    print $"    cargo build: ($rebuild_elapsed)"
    print ""
    if $baseline_elapsed > 0sec and $rebuild_elapsed > 0sec {
        let speedup = (($baseline_elapsed | into int) / ($rebuild_elapsed | into int))
        print $"  Cargo speedup: ($speedup)x"
        print ""
    }
    print $"  Sandbox rustc cache: ($fresh_cached) / ($fresh_total) served from remote"
    print "========================================"

    print ""
    print "Cleaning up..."
    do_cleanup
    print "  Done."
}

# Recursively collect every descendant of root via process_children.
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

# Locate orphan rustc processes (no tangram-tree parent) by time window. cargo
# on the host spawns these via the wrapper, but the spawns have no parent
# tangram process so they do not appear in process_children.
def find_orphan_rustc [
    tangram_dir: string, start_ts: int, end_ts: int
]: nothing -> list<string> {
    let query = $"SELECT id FROM processes WHERE created_at >= ($start_ts) AND created_at <= ($end_ts) AND id NOT IN \(SELECT child FROM process_children)"
    sqlite3 $"($tangram_dir)/processes" $query
        | lines
        | where { |l| not ($l | is-empty) }
}

# Count how many of the listed processes existed prior to the rebuild window —
# i.e. were pulled from the remote rather than freshly created here.
def count_pre_existing [
    tangram_dir: string, pcs_list: list<string>, threshold_ts: int
]: nothing -> int {
    if ($pcs_list | is-empty) { return 0 }
    let in_clause = ($pcs_list | each { |p| $"'($p)'" } | str join ",")
    let query = $"SELECT count\(*) FROM processes WHERE id IN \(($in_clause)) AND created_at < ($threshold_ts)"
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

def save_pid [pid: int] {
    $"($pid)\n" | save --append $PID_FILE
}

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
