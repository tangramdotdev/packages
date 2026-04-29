#!/usr/bin/env nu

def main [
    hash?: string # The commit hash to use. Defaults to HEAD of tangramdotdev/tangram.
    --auto-commit # Commit changes without prompting.
] {
    let root = $env.FILE_PWD | path dirname
    let hash = $hash | default (git ls-remote https://github.com/tangramdotdev/tangram HEAD | split row "\t" | first)

    let files = glob $"($root)/**/Cargo.toml" | where { open $in --raw | str contains "tangramdotdev/tangram" }
    if ($files | is-empty) { return }

    for f in $files {
        open $f --raw | str replace -ar '(tangramdotdev/tangram[^\n]*?rev = ")[a-f0-9]{40}' $"${1}($hash)" | save -f $f
    }

    let roots = $files | each { |f| cargo locate-project --workspace --manifest-path $f --message-format plain | str trim } | uniq
    for r in $roots {
        cargo update --manifest-path $r
        cargo clippy --manifest-path $r --all-targets --all-features -- -D warnings
    }

    cd $root
    if (git status --porcelain | lines | where { $in =~ 'Cargo\.(toml|lock)$' } | is-empty) { return }
    git diff --stat -- "*.toml" "*.lock"
    if $auto_commit or ((input "Commit? [y/N] " | str trim | str downcase) == "y") {
        git add -- "*/Cargo.toml" "*/Cargo.lock"; git commit -m $"chore: update tangram deps to ($hash | str substring 0..7)"
    }
}
