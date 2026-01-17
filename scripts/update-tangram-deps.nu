#!/usr/bin/env nu

def main [
    hash?: string # The commit hash to use. Defaults to HEAD of tangramdotdev/tangram.
    --auto-commit # Commit changes without prompting.
] {
    let root = $env.FILE_PWD | path dirname
    let hash = $hash | default (git ls-remote https://github.com/tangramdotdev/tangram HEAD | split row "\t" | first)

    # Find and update all Cargo.toml files with tangram git dependencies.
    let files = glob $"($root)/**/Cargo.toml" | where { open $in --raw | str contains "tangramdotdev/tangram" }
    for f in $files { open $f --raw | str replace -ar 'rev = "[a-f0-9]{40}"' $'rev = "($hash)"' | save -f $f }

    # Run cargo update and clippy in each workspace.
    for d in ($files | each { path dirname } | uniq) { cd $d; cargo update; cargo clippy --all-targets --all-features -- -D warnings }

    # Commit only modified Cargo.toml and Cargo.lock files.
    cd $root
    if (git status --porcelain | lines | where { $in =~ 'Cargo\.(toml|lock)$' } | is-empty) { return }
    git diff --stat -- "*.toml" "*.lock"
    if $auto_commit or ((input "Commit? [y/N] " | str trim | str downcase) == "y") {
        git add -- "*/Cargo.toml" "*/Cargo.lock"; git commit -m $"chore: update tangram deps to ($hash | str substring 0..7)"
    }
}
