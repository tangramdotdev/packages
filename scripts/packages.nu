#!/usr/bin/env nu

# The packages that are not run unless they are named.
const EXCLUDED = ["demo" "sanity" "webdemo"]

# The packages that have no build of their own, so that the test action does not build their default export.
const BUILD_SKIP = ["autobuild"]

# Run an action on packages. Arguments that start with `-` are passed to the tg subcommand, and the other arguments name the packages or package paths to run on, which defaults to every package.
def --wrapped main [
    action: string # One of check, format, publish, or test.
    ...args: string
] {
    cd ($env.FILE_PWD | path dirname)
    let flags = $args | where { $in | str starts-with "-" }
    let names = $args | where { not ($in | str starts-with "-") }
    let packages = resolve $names
    match $action {
        "check" => { run_each $packages { |package| ^tg check ...$flags $package.path } }
        "format" => { run_each $packages { |package| ^tg format ...$flags $package.path } }
        "publish" => { publish $packages $flags }
        "test" => { run_each $packages { |package| test $package $flags } }
        _ => { error make { msg: $"unknown action ($action)." } }
    }
}

# Publish the packages, with every tagged dependency, in one publish that replaces conflicting tags unless `--force` is already passed.
def publish [packages: list<record>, flags: list<string>] {
    let force = if ("--force" in $flags or "-f" in $flags) { [] } else { ["--force"] }
    ^tg publish ...$force ...$flags ...($packages | get path)
}

# Build the package's default export and then its test export, and skip the package on a host that it does not support.
def test [package: record, flags: list<string>] {
    let targets = if $package.name in $BUILD_SKIP { [] } else { [$package.path] }
    for target in [...$targets $"($package.path)#test"] {
        print $"build ($target)"
        let output = do { ^tg build ...$flags $target } | complete
        if $output.exit_code != 0 {
            if ($output.stderr | str contains "not found in supported hosts") {
                print $"skip ($package.name): unsupported host"
                return
            }
            print --stderr $output.stderr
            error make { msg: $"the build of ($target) failed." }
        }
    }
}

# Run the closure on each package, continue after a failure, and exit with an error that names the failed packages.
def run_each [packages: list<record>, closure: closure] {
    let failed = $packages | each { |package|
        print $"($package.name): ($package.path)"
        let ok = try { do $closure $package; true } catch { |error| print --stderr $error.msg; false }
        if $ok { null } else { $package.name }
    }
    print $"total: ($packages | length), failed: ($failed | length)"
    if ($failed | is-not-empty) {
        print --stderr $"failed: ($failed | str join ' ')"
        exit 1
    }
}

# Resolve the named packages in order, or discover every package that is not excluded, sorted with std first.
def resolve [names: list<string>] {
    if ($names | is-not-empty) {
        return ($names | each { |name| resolve_one $name })
    }
    let packages = ls packages | each { |entry| package $entry.name } | compact | where { $in.name not-in $EXCLUDED } | sort-by name
    [...($packages | where name == "std") ...($packages | where name != "std")]
}

# Resolve a package name, such as ripgrep, or a package path relative to the repository, such as ./packages/ripgrep.tg.ts.
def resolve_one [name: string] {
    let package = if ($name | str contains "/") {
        package ($name | str replace -r '^\./' '' | str trim --right --char "/")
    } else {
        ls packages | each { |entry| package $entry.name } | compact | where name == $name | get 0?
    }
    if $package == null {
        error make { msg: $"there is no package named ($name)." }
    }
    $package
}

# Return the package at the path, where a directory is a package if it has a root module and a file is a package if it is named <package>.tg.<extension>, or null.
def package [path: string] {
    let basename = $path | path basename
    let type = $path | path type
    if $type == "file" and ($basename =~ '^.+\.tg\.[^.]+$') {
        return { name: ($basename | str replace -r '\.tg\.[^.]+$' ''), path: $"./($path)" }
    }
    if $type == "dir" {
        let root = ls $path | where type == file | get name | each { path basename } | where { $in =~ '^tangram\.[^.]+$' and $in != "tangram.lock" }
        if ($root | is-not-empty) {
            return { name: $basename, path: $"./($path)" }
        }
    }
    null
}
