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
# Usage:
#   # With defaults (primary at /opt/tangram, workspace at ~/code/tangram)
#   nu test-remote-cache.nu
#
#   # With overrides
#   TANGRAM_DIRECTORY=/path/to/tangram TANGRAM_WORKSPACE=/path/to/workspace nu test-remote-cache.nu
#
# Environment variables:
#   TANGRAM_DIRECTORY  — path to primary tangram data directory (default: /opt/tangram)
#   TANGRAM_WORKSPACE  — path to tangram workspace to build (default: ~/code/tangram)
#   REMOTE_PORT        — port for the remote cache server (default: 8081)
#   FRESH_PORT         — port for the fresh server (default: 8082)

def main [] {
    let tangram_dir = ($env.TANGRAM_DIRECTORY? | default "/opt/tangram")
    let workspace = ($env.TANGRAM_WORKSPACE? | default ($env.HOME + "/code/tangram"))
    let remote_port = ($env.REMOTE_PORT? | default "8081" | into int)
    let fresh_port = ($env.FRESH_PORT? | default "8082" | into int)
    let remote_dir = "/tmp/tangram-remote-test"
    let fresh_dir = "/tmp/tangram-fresh-test"
    let remote_name = "test-remote-cache"

    print "Configuration:"
    print $"  Primary directory: ($tangram_dir)"
    print $"  Workspace: ($workspace)"
    print $"  Remote server: http://localhost:($remote_port) \(($remote_dir))"
    print $"  Fresh server:  http://localhost:($fresh_port) \(($fresh_dir))"
    print ""

    # Validate prerequisites.
    if not ($tangram_dir | path exists) {
        error make { msg: $"Primary tangram directory ($tangram_dir) does not exist." }
    }
    if not ($workspace | path exists) {
        error make { msg: $"Workspace ($workspace) does not exist." }
    }

    # Clean up any previous test state.
    cleanup $remote_dir $fresh_dir $remote_name
    mkdir $remote_dir
    mkdir $fresh_dir

    # Step 1: Start the remote cache server.
    print "Step 1: Starting remote cache server..."
    let remote_pid = (start_server $remote_dir $remote_port)
    print $"  Remote server started \(PID ($remote_pid))."

    # Step 2: Run an initial build on the primary server to populate the cache.
    print "Step 2: Running baseline build on primary server..."
    let baseline_log = "/tmp/tgrustc-remote-baseline.log"
    bash -c $"cd ($workspace) && cargo clean" o+e>| ignore
    let baseline_start = (date now)
    bash -c $"cd ($workspace) && cargo build 2>&1 | tee ($baseline_log)"
    let baseline_elapsed = (date now) - $baseline_start
    print $"  Baseline build completed in ($baseline_elapsed)."

    # Step 3: Find the most recent run process with ~697 rustc children.
    print "Step 3: Finding run process in primary database..."
    let run_process = (find_run_process $tangram_dir)
    let child_count = (count_rustc_children $tangram_dir $run_process)
    print $"  Found process ($run_process) with ($child_count) rustc children."

    # Step 4: Find all related processes from the build window.
    # The run process has the 697 proxy children, but there are also build-phase
    # processes (SDK, toolchain, tgrustc binary) that the fresh server would
    # otherwise need to rebuild. Push all finished cacheable processes from the
    # build window.
    print "Step 4: Collecting build-phase processes..."
    let build_processes = (find_build_window_processes $tangram_dir $run_process)
    let total_processes = ($build_processes | length)
    print $"  Found ($total_processes) cacheable processes in the build window."

    # Step 5: Configure a remote on the primary server and push all processes.
    print "Step 5: Pushing processes to remote server..."
    tangram remote put $remote_name $"http://localhost:($remote_port)"

    # Push the run process and its children recursively.
    print $"  Pushing run process ($run_process) recursively..."
    tangram push $run_process --recursive --eager --outputs --remote $remote_name

    # Push build-phase processes.
    let unique_build = ($build_processes | where { |p| $p != $run_process })
    if ($unique_build | length) > 0 {
        print $"  Pushing ($unique_build | length) build-phase processes..."
        for process_id in $unique_build {
            try {
                tangram push $process_id --recursive --eager --outputs --remote $remote_name
            } catch {
                print $"  Warning: Failed to push ($process_id), continuing..."
            }
        }
    }

    # Clean up the remote on the primary server.
    tangram remote delete $remote_name
    print "  Push complete."

    # Step 6: Start the fresh server with the remote configured.
    print "Step 6: Starting fresh server..."
    let fresh_pid = (start_server $fresh_dir $fresh_port)
    sleep 2sec

    # Configure the remote on the fresh server.
    with-env { TANGRAM_URL: $"http://localhost:($fresh_port)" } {
        tangram remote put $remote_name $"http://localhost:($remote_port)"
    }
    print $"  Fresh server started \(PID ($fresh_pid)) with remote configured."

    # Step 7: Rebuild from the fresh server.
    print "Step 7: Rebuilding from fresh server (should pull from remote)..."
    let rebuild_log = "/tmp/tgrustc-remote-rebuild.log"
    bash -c $"cd ($workspace) && cargo clean" o+e>| ignore
    let rebuild_start = (date now)
    bash -c $"cd ($workspace) && TANGRAM_URL=http://localhost:($fresh_port) cargo build 2>&1 | tee ($rebuild_log)"
    let rebuild_elapsed = (date now) - $rebuild_start

    # Step 8: Verify cache hits on the fresh server.
    print ""
    print "Step 8: Verifying cache state on fresh server..."
    let fresh_run = (find_run_process $fresh_dir)
    let fresh_children = (count_rustc_children $fresh_dir $fresh_run)
    print $"  Fresh server run process: ($fresh_run)"
    print $"  Fresh server rustc children: ($fresh_children)"

    # Count cached vs uncached from the fresh server database.
    let cached_count = (run_sql $fresh_dir "SELECT count(*) FROM processes WHERE cacheable = 1 AND status = 'finished' AND actual_checksum IS NOT NULL" | into int)
    let total_count = (run_sql $fresh_dir "SELECT count(*) FROM processes WHERE cacheable = 1 AND status = 'finished'" | into int)
    print $"  Cached processes: ($cached_count) / ($total_count)"

    # Step 9: Report results.
    print ""
    print "========================================"
    print "  Results"
    print "========================================"
    print $"  Baseline \(uncached):  ($baseline_elapsed)"
    print $"  Remote pull \(fresh):  ($rebuild_elapsed)"
    if $baseline_elapsed > 0sec {
        let speedup = (($baseline_elapsed | into int) / ($rebuild_elapsed | into int))
        print $"  Speedup:              ($speedup)x"
    }
    print $"  Rustc children:       ($fresh_children) \(expected ~697)"
    print "========================================"

    # Step 10: Cleanup.
    print ""
    print "Step 10: Cleaning up..."
    kill_server $remote_pid
    kill_server $fresh_pid
    rm -rf $remote_dir
    rm -rf $fresh_dir
    print "  Done."
}

# Run a SQL query against a tangram database and return the trimmed result.
def run_sql [tangram_dir: string, query: string]: nothing -> string {
    sqlite3 $"($tangram_dir)/database" $query | str trim
}

# Start a tangram server in the background. Returns the PID.
def start_server [dir: string, port: int]: nothing -> int {
    let url = $"http://localhost:($port)"
    let log_file = $"/tmp/tangram-serve-($port).log"
    let pid = (bash -c $"tangram serve -d ($dir) -u ($url) > ($log_file) 2>&1 & echo $!" | str trim | into int)
    # Wait briefly for the server to start.
    sleep 2sec
    $pid
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

# Find all finished cacheable processes from the build window surrounding a run process.
def find_build_window_processes [tangram_dir: string, run_process: string]: nothing -> list<string> {
    # Get the created_at timestamp of the run process.
    let run_created = (run_sql $tangram_dir $"SELECT created_at FROM processes WHERE id = '($run_process)'" | into int)

    # Find all finished cacheable processes created within 5 minutes before and after the run process.
    # This captures the build phase (SDK, toolchain, etc.) that precedes the run.
    let window_start = ($run_created - 300)
    let window_end = ($run_created + 300)
    run_sql $tangram_dir $"SELECT id FROM processes WHERE cacheable = 1 AND status = 'finished' AND created_at >= ($window_start) AND created_at <= ($window_end)"
        | lines
        | where { |line| not ($line | is-empty) }
}

# Clean up test artifacts from a previous run.
def cleanup [remote_dir: string, fresh_dir: string, remote_name: string] {
    # Remove temp directories if they exist.
    if ($remote_dir | path exists) { rm -rf $remote_dir }
    if ($fresh_dir | path exists) { rm -rf $fresh_dir }

    # Remove test remote from primary server if it exists.
    try { tangram remote delete $remote_name } catch { }

    # Kill any leftover test server processes.
    bash -c "pkill -f 'tangram serve -d /tmp/tangram-remote-test' 2>/dev/null || true" o+e>| ignore
    bash -c "pkill -f 'tangram serve -d /tmp/tangram-fresh-test' 2>/dev/null || true" o+e>| ignore
}
