#!/usr/bin/env nu

# Can a client with an empty cache run ./packages/demo without building anything?
#
# Three servers: the primary (this machine's warm cache) publishes and releases to an empty remote; a
# fresh server whose only remote is that one stands in for the cold machine.
#
# Nothing is pushed recursively. The release action pushes one tag per export, so the client gets the
# output of each package and never the graph that produced it. The oracle is the per-child `cached`
# flag on the fresh server's process record: any child it executed itself is a miss.
#
#   nu scripts/remote_cache_experiment.nu
#   nu scripts/remote_cache_experiment.nu --cleanup

const ROOT = "/tmp/tangram-cache-experiment"
const REMOTE = $"($ROOT)/remote"
const FRESH = $"($ROOT)/fresh"

# Prove the tools are on PATH, came from a tangram artifact rather than the host, and actually work.
# The artifact check matters because a host install of rg or jq would otherwise satisfy this.
const CHECK = "set -e
rg_path=$(command -v rg)
jq_path=$(command -v jq)
echo \"rg -> $rg_path\"
echo \"jq -> $jq_path\"
case $rg_path in */store/*) ;; *) echo 'rg is not from a tangram artifact'; exit 1 ;; esac
case $jq_path in */store/*) ;; *) echo 'jq is not from a tangram artifact'; exit 1 ;; esac
echo beta | rg -q beta
echo '{\"a\":[1,2,3]}' | jq -e '.a[1] == 2' > /dev/null
echo FUNCTIONAL-OK"

def main [--cleanup, --remote-port: int = 8091] {
    cleanup
    if $cleanup { return }

    # Only the remote needs a TCP listener, since the primary and the fresh server both talk to it.
    # The fresh server is never dialled by anyone, so it is left to auto-start on its own unix socket
    # when the first `tangram -d $FRESH` command runs. Starting it explicitly on TCP would make those
    # client commands miss it, try to launch a second server, and fail.
    let url = $"http://localhost:($remote_port)"
    mkdir $REMOTE
    mkdir $FRESH
    ^bash -c $"tangram serve -d ($REMOTE) -u ($url) > ($ROOT)/remote.log 2>&1 &"
    sleep 2sec

    # The primary gets its own named remote so an existing `default` is never disturbed. The fresh
    # server is a throwaway directory, and remotes are stored per server, so `default` is safe there.
    ^tangram remote put experiment $url
    ^tangram -d $FRESH remote put default $url

    # Publish the source closure and release the build outputs, one tag per export. `--eager` pushes
    # the object bytes, which the cold client has no other way to obtain; it is orthogonal to
    # recursion, which stays off so the build graphs beneath each output are never pushed.
    ^bun run auto -pr --eager --remote=experiment std jq ripgrep

    # Evaluate the demo on the fresh server. Its own root process is not cached anywhere, so it runs;
    # every child it reaches should resolve from the remote instead of executing.
    let process = (^tangram -d $FRESH build --detach ./packages/demo | str trim)
    # Capture the wait result rather than discarding it. A failed evaluation still leaves a process
    # record behind, so the child census below would otherwise be taken over a partial run and report
    # a clean sweep for a build that never finished.
    let evaluation = (do -i { ^tangram -d $FRESH wait $process } | complete)
    if $evaluation.exit_code != 0 {
        print $"(ansi red_bold)FAIL(ansi reset) the evaluation of ./packages/demo failed on the cold client."
        print $evaluation.stderr
    }
    let children = (^tangram -d $FRESH process get $process | from json | get children)
    let executed = ($children | where { |c| ($c.cached? | default false) == false })

    # Wrapping is expected to happen on the client: composing a different env, or adding a variable
    # to it, must produce a new wrapper without rebuilding anything. Any other local execution is a
    # cache miss on something that should have been downloaded. The wrapper export resolves which
    # wrapper artifact to use and compiles nothing, so it belongs with the manifest steps.
    let wrap = ["read+manifest" "write+manifest" "codesign" "default+wrapper"]

    # The codesign step runs rcodesign, which the client fetches itself. Allowing every download by
    # name would also hide a package source download, which is a real miss, so the URL decides.
    let unexpected = ($executed | where { |c|
        if ($wrap | any { |w| $c.process | str contains $"name=($w)" }) {
            false
        } else if ($c.process | str contains "name=download") {
            let id = ($c.process | split row '?' | first)
            let command = (^tangram -d $FRESH process get $id | from json | get command)
            not (^tangram -d $FRESH get $command | str contains "apple-codesign")
        } else {
            true
        }
    })

    print $"children: ($children | length), executed: ($executed | length), unexpected: ($unexpected | length)"
    for c in $unexpected { print $"  unexpected: ($c.process)" }

    let result = (do -i {
        ^tangram -d $FRESH run -b ./packages/demo -- sh -c $CHECK
    } | complete)
    print $result.stdout
    if $evaluation.exit_code == 0 and $result.exit_code == 0 and ($result.stdout | str contains "FUNCTIONAL-OK") and ($unexpected | is-empty) {
        print $"(ansi green_bold)PASS(ansi reset) the cold client wrapped locally and built nothing."
    } else {
        print $"(ansi red_bold)FAIL(ansi reset) exit ($result.exit_code)"
        print $result.stderr
    }
}

def cleanup [] {
    # Match on the directory rather than on `serve -d`, so the auto-started fresh server is caught
    # too. The pattern is scoped to this script's temp directory.
    ^bash -c $"pkill -f '($ROOT)' 2>/dev/null || true" | ignore
    sleep 500ms
    # A server checks its artifacts out read only, so the tree has to be made writable before it can
    # be removed.
    ^bash -c $"chmod -R u+w ($ROOT) 2>/dev/null || true" | ignore
    rm -rf $ROOT
    # Remove only the remote this script added, so an unrelated `default` survives untouched.
    # `complete` captures stderr as well, since this is expected to fail on the first run.
    do -i { ^tangram remote delete experiment } | complete | ignore
}
