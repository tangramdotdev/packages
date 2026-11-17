#!/usr/bin/env nu

# Can a client with an empty cache run the demo package without building anything?
#
# A fresh server whose only remote is Tangram Cloud stands in for the cold machine. The demo package
# imports std, jq, and ripgrep by tag, so everything it needs must come from that remote. The oracle
# is the per-child `cached` flag on the fresh server's process record: any child it executed itself
# is a miss.
#
# The script only reads from the remote unless `--publish` is passed. Publishing runs on this
# machine's primary server, which must already have the named remote configured and be logged in to
# it. Nothing is pushed recursively: the release action pushes one tag per export, so the client
# gets the output of each package and never the graph that produced it.
#
#   nu scripts/remote_cache_experiment.nu
#   nu scripts/remote_cache_experiment.nu --publish
#   nu scripts/remote_cache_experiment.nu --remote-url http://localhost:8091
#   nu scripts/remote_cache_experiment.nu --cleanup

const ROOT = "/tmp/tangram-cache-experiment"
const FRESH = $"($ROOT)/fresh"
const CONFIG = $"($ROOT)/config.json"
const PACKAGES = ["std" "jq" "ripgrep"]
const PACKAGE = (path self | path dirname | path join "remote_cache_experiment")

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

def main [
    --cleanup # Remove the fresh server and exit.
    --publish # Publish and release std, jq, and ripgrep from the primary server first.
    --publish-remote: string = "default" # The primary server's name for the remote to publish to.
    --remote-url: string = "https://tangram.cloud" # The remote the cold client pulls from.
] {
    cleanup
    if $cleanup { return }

    # Publish the source closure and release the build outputs, one tag per export. `--eager` pushes
    # the object bytes, which the cold client has no other way to obtain; it is orthogonal to
    # recursion, which stays off so the build graphs beneath each output are never pushed.
    if $publish {
        ^bun run auto -pr --eager $"--remote=($publish_remote)" ...$PACKAGES
    }

    # The fresh server gets its own config, so that neither the user's remotes nor their token leak
    # into the cold client. The config is authoritative for remotes, and the remote must be trusted
    # for its processes to count as cache hits. The server is never dialled by anyone else, so it is
    # left to auto-start on its own unix socket when the first command runs.
    mkdir $FRESH
    {
        directory: $FRESH,
        remotes: { default: { url: $remote_url, trusted: true } },
    } | to json | save --force $CONFIG

    # Fail early with the transport error when the remote cannot be reached, instead of reporting
    # every package as a cache miss.
    let health = (do -i { ^curl -sS -m 15 -o /dev/null $"($remote_url)/health" } | complete)
    if $health.exit_code != 0 {
        print $"(ansi red_bold)FAIL(ansi reset) the cold client cannot reach ($remote_url)."
        print $health.stderr
        exit 1
    }

    # Require a release for this platform before taking the census. A remote that was only ever
    # published to from another platform has nothing for this client to hit, which would otherwise
    # be indistinguishable from a cache that does not work.
    let platform = (host_platform)
    let missing = ($PACKAGES | each { |package| missing_release $package $platform } | compact)
    if ($missing | is-not-empty) {
        print $"(ansi red_bold)FAIL(ansi reset) ($remote_url) lacks a ($platform) release of a package, so the census would only measure that."
        for m in $missing { print $"  ($m)" }
        print $"Publish from an ($platform) machine, for example with --publish, and run this again."
        exit 1
    }

    # Evaluate the demo on the fresh server. Its own root process is not cached anywhere, so it runs;
    # every child it reaches should resolve from the remote instead of executing.
    let process = (^tangram -c $CONFIG build --detach $PACKAGE | str trim)
    # Capture the wait result rather than discarding it. A failed evaluation still leaves a process
    # record behind, so the child census below would otherwise be taken over a partial run and report
    # a clean sweep for a build that never finished.
    let evaluation = (do -i { ^tangram -c $CONFIG wait $process } | complete)
    if $evaluation.exit_code != 0 {
        print $"(ansi red_bold)FAIL(ansi reset) the evaluation of the demo failed on the cold client."
        print $evaluation.stderr
    }
    let children = (^tangram -c $CONFIG process get $process | from json | get children)
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
            let command = (^tangram -c $CONFIG process get $id | from json | get command)
            not (^tangram -c $CONFIG get $command | str contains "apple-codesign")
        } else {
            true
        }
    })

    print $"children: ($children | length), executed: ($executed | length), unexpected: ($unexpected | length)"
    for c in $unexpected { print $"  unexpected: ($c.process)" }

    let result = (do -i {
        ^tangram -c $CONFIG run -b $PACKAGE -- sh -c $CHECK
    } | complete)
    print $result.stdout
    if $evaluation.exit_code == 0 and $result.exit_code == 0 and ($result.stdout | str contains "FUNCTIONAL-OK") and ($unexpected | is-empty) {
        print $"(ansi green_bold)PASS(ansi reset) the cold client wrapped locally and built nothing."
    } else {
        print $"(ansi red_bold)FAIL(ansi reset) exit ($result.exit_code)"
        print $result.stderr
        exit 1
    }
}

# Describe what the remote lacks for the package on the platform, or return null if the latest
# version has a release there. The demo imports each package by its bare name, which resolves to
# the latest version, so that is the version whose release must exist.
def missing_release [package: string, platform: string] {
    let listed = (do -i { ^tangram -c $CONFIG list --remote --all $package } | complete)
    let versions = if $listed.exit_code == 0 {
        $listed.stdout | from json | where { |e| $e.node.node | str starts-with "tag_" } | get specifier | path basename | sort --natural
    } else {
        []
    }
    if ($versions | is-empty) {
        return $"($package): no version is published."
    }
    let version = ($versions | last)
    let builds = $"($package)/builds/($version)/default"
    let found = (do -i { ^tangram -c $CONFIG tag get --remote $"($builds)/($platform)" } | complete)
    if $found.exit_code == 0 {
        return null
    }
    let others = (do -i { ^tangram -c $CONFIG list --remote --all $builds } | complete)
    let platforms = if $others.exit_code == 0 {
        $others.stdout | from json | get specifier | path basename
    } else {
        []
    }
    let have = if ($platforms | is-empty) { "none" } else { $platforms | str join ", " }
    $"($package)/($version): no ($platform) release. Released platforms: ($have)."
}

# The platform segment of a release tag, in the form the automation writes it.
def host_platform [] {
    let os = if $nu.os-info.name == "macos" { "darwin" } else { $nu.os-info.name }
    $"($nu.os-info.arch)-($os)"
}

def cleanup [] {
    # Match on the directory, so the auto-started fresh server is caught. The pattern is scoped to
    # this script's temp directory.
    ^bash -c $"pkill -f '($ROOT)' 2>/dev/null || true" | ignore
    sleep 500ms
    # A server checks its artifacts out read only, so the tree has to be made writable before it can
    # be removed.
    ^bash -c $"chmod -R u+w ($ROOT) 2>/dev/null || true" | ignore
    rm -rf $ROOT
}
