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
# `--local-remote` rehearses the whole publish-then-check workflow against a throwaway remote on
# this machine, so that nothing is written to a shared deployment.
#
#   nu scripts/remote_cache_experiment.nu
#   nu scripts/remote_cache_experiment.nu --publish
#   nu scripts/remote_cache_experiment.nu --local-remote
#   nu scripts/remote_cache_experiment.nu --remote-url http://localhost:8091
#   nu scripts/remote_cache_experiment.nu --cleanup

const ROOT = "/tmp/tangram-cache-experiment"
const FRESH = $"($ROOT)/fresh"
const CONFIG = $"($ROOT)/config.json"
const REMOTE = $"($ROOT)/remote"
const REMOTE_CONFIG = $"($ROOT)/remote.json"
const LOCAL_REMOTE_NAME = "experiment"
const PACKAGES = ["std" "jq" "ripgrep"]
const REPOSITORY = (path self | path dirname | path dirname)
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
    --cleanup # Remove the experiment's servers and exit.
    --local-remote # Publish to and pull from a throwaway remote on this machine.
    --local-remote-port: int = 8091 # The port the throwaway remote listens on.
    --publish # Publish and release std, jq, and ripgrep from the primary server first.
    --publish-remote: string = "default" # The primary server's name for the remote to publish to.
    --remote-url: string = "https://tangram.cloud" # The remote the cold client pulls from.
] {
    cleanup
    if $cleanup { return }

    # A throwaway remote starts empty, so it is always published to. The primary gets its own named
    # remote for it, so that an existing `default` is never disturbed.
    let remote_url = if $local_remote { $"http://localhost:($local_remote_port)" } else { $remote_url }
    let publish_remote = if $local_remote { $LOCAL_REMOTE_NAME } else { $publish_remote }
    let publish = $publish or $local_remote
    if $local_remote {
        start_local_remote $remote_url
        ^tangram remote put $LOCAL_REMOTE_NAME $remote_url
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
        fail $"the cold client cannot reach ($remote_url)." [$health.stderr]
    }

    # Publish the source closure and release the build outputs, one tag per export. `--eager` pushes
    # the object bytes, which the cold client has no other way to obtain; it is orthogonal to
    # recursion, which stays off so the build graphs beneath each output are never pushed.
    if $publish {
        let problems = (publish_problems $publish_remote $remote_url $local_remote)
        if ($problems | is-not-empty) {
            fail "the primary server is not set up to publish to the remote the cold client pulls from." $problems
        }
        try {
            ^bun run auto -pr --eager $"--remote=($publish_remote)" ...$PACKAGES
        } catch {
            fail "the publish and release failed on the primary server."
        }

        # Tie the check to this publish. The demo resolves the latest version on the remote, so a
        # newer or different publish there would be measured in place of the one just made.
        let stale = ($PACKAGES | each { |package| unpublished $package } | compact)
        if ($stale | is-not-empty) {
            fail $"($remote_url) does not serve what the primary server just published." $stale
        }
    }

    # Require a release for this platform before taking the census. A remote that was only ever
    # published to from another platform has nothing for this client to hit, which would otherwise
    # be indistinguishable from a cache that does not work.
    let platform = (host_platform)
    let missing = ($PACKAGES | each { |package| missing_release $package $platform } | compact)
    if ($missing | is-not-empty) {
        fail $"($remote_url) lacks an ($platform) release of a package, so the census would only measure that." [
            ...$missing
            $"Publish from an ($platform) machine, for example with --publish, and run this again."
        ]
    }

    # Evaluate the demo on the fresh server. Its own root process is not cached anywhere, so it runs;
    # every child it reaches should resolve from the remote instead of executing.
    let process = (^tangram -c $CONFIG build --detach $PACKAGE | str trim)
    ^tangram -c $CONFIG wait $process | complete | ignore
    # Read the outcome from the process record rather than from the wait, which succeeds for a
    # process that failed. A failed evaluation still leaves a record behind, so the child census
    # below would otherwise be taken over a partial run and report a clean sweep for a build that
    # never finished.
    let record = (^tangram -c $CONFIG process get $process | from json)
    let evaluated = ($record.error? == null) and (($record.exit? | default 0) == 0)
    if not $evaluated {
        print $"(ansi red_bold)FAIL(ansi reset) the evaluation of the demo failed on the cold client."
    }
    let children = ($record.children? | default [])
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
            # The record carries the command inline, or its ID when the command is stored.
            let command = if ($command | describe) == "string" { ^tangram -c $CONFIG get $command } else { $command | to json --raw }
            not ($command | str contains "apple-codesign")
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
    if $evaluated and $result.exit_code == 0 and ($result.stdout | str contains "FUNCTIONAL-OK") and ($unexpected | is-empty) {
        print $"(ansi green_bold)PASS(ansi reset) the cold client wrapped locally and built nothing."
    } else {
        fail $"exit ($result.exit_code)" [$result.stderr]
    }
}

# Print the failure with its details and exit.
def fail [message: string, details: list<string> = []] {
    print $"(ansi red_bold)FAIL(ansi reset) ($message)"
    for d in $details { print $"  ($d)" }
    exit 1
}

# Start the throwaway remote and wait until it answers. It gets its own config, so that the user's
# config does not apply to it.
def start_local_remote [url: string] {
    mkdir $REMOTE
    { directory: $REMOTE, remotes: {} } | to json | save --force $REMOTE_CONFIG
    ^bash -c $"tangram -c ($REMOTE_CONFIG) serve -u ($url) > ($ROOT)/remote.log 2>&1 &"
    for _ in 1..50 {
        if (do -i { ^curl -sS -m 2 -o /dev/null $"($url)/health" } | complete).exit_code == 0 { return }
        sleep 200ms
    }
    fail $"the throwaway remote did not start at ($url)." [$"See ($ROOT)/remote.log."]
}

# List what stops the primary server from publishing to the remote the cold client pulls from. A
# throwaway remote has no authentication, so there is no login to check.
def publish_problems [name: string, url: string, local_remote: bool] {
    let remote = (do -i { ^tangram remote get $name } | complete)
    if $remote.exit_code != 0 {
        return [$"The primary server has no remote named `($name)`. Add it to the `remotes` key of its config."]
    }
    let configured = ($remote.stdout | from json | get url | str trim --right --char "/")
    if $configured != ($url | str trim --right --char "/") {
        return [$"The primary server's remote `($name)` is ($configured), but the cold client pulls from ($url)."]
    }
    if $local_remote { return [] }
    if (do -i { ^tangram whoami $"--remote=($name)" } | complete).exit_code != 0 {
        return [$"The primary server is not logged in to `($name)`. Run `tangram login --remote=($name)`."]
    }
    []
}

# Describe how the remote differs from what the primary server published for the package, or return
# null if the remote serves the same package tag and no later version.
def unpublished [package: string] {
    let file = ($REPOSITORY | path join "packages" $"($package).tg.ts")
    let path = if ($file | path exists) { $file } else { $REPOSITORY | path join "packages" $package }
    let metadata = (^tangram build $"($path)#metadata" | from json)
    let tag = $metadata.tag
    let primary = (do -i { ^tangram tag get --local $tag } | complete)
    if $primary.exit_code != 0 {
        return $"($tag): the primary server has no such tag."
    }
    let remote = (do -i { ^tangram -c $CONFIG tag get --remote $tag } | complete)
    if $remote.exit_code != 0 {
        return $"($tag): the remote has no such tag."
    }
    let primary = ($primary.stdout | from json | get target.id)
    let remote = ($remote.stdout | from json | get target.id)
    if $primary != $remote {
        return $"($tag): the remote targets ($remote), but the primary server published ($primary)."
    }
    let latest = (latest_version $package)
    if $latest != $metadata.version {
        return $"($tag): the remote's latest version is ($latest), which is what the demo would resolve."
    }
    null
}

# Describe what the remote lacks for the package on the platform, or return null if the latest
# version has a release there. The demo imports each package by its bare name, which resolves to
# the latest version, so that is the version whose release must exist.
def missing_release [package: string, platform: string] {
    let version = (latest_version $package)
    if $version == null {
        return $"($package): no version is published."
    }
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

# The latest version of the package on the remote, or null if none is published.
def latest_version [package: string] {
    let listed = (do -i { ^tangram -c $CONFIG list --remote --all $package } | complete)
    if $listed.exit_code != 0 { return null }
    let versions = ($listed.stdout | from json | where { |e| $e.node.node | str starts-with "tag_" } | get specifier | path basename | sort --natural)
    if ($versions | is-empty) { null } else { $versions | last }
}

# The platform segment of a release tag, in the form the automation writes it.
def host_platform [] {
    let os = if $nu.os-info.name == "macos" { "darwin" } else { $nu.os-info.name }
    $"($nu.os-info.arch)-($os)"
}

def cleanup [] {
    # Match on the directory, so the auto-started fresh server is caught along with the throwaway
    # remote. The pattern is scoped to this script's temp directory.
    ^bash -c $"pkill -f '($ROOT)' 2>/dev/null || true" | ignore
    sleep 500ms
    # A server checks its artifacts out read only, so the tree has to be made writable before it can
    # be removed.
    ^bash -c $"chmod -R u+w ($ROOT) 2>/dev/null || true" | ignore
    rm -rf $ROOT
    # Remove the demo's lockfile, which pins the tags an earlier run resolved. A cold client has no
    # lockfile, and one from a different remote names objects this remote does not have.
    rm -f ($PACKAGE | path join "tangram.lock")
    # Remove only the remote this script added, so an unrelated `default` survives untouched.
    # `complete` captures stderr as well, since this is expected to fail when it was never added.
    do -i { ^tangram remote delete $LOCAL_REMOTE_NAME } | complete | ignore
}
