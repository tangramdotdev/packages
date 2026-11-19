# Tangram Packages

This repository contains a collection of community maintained Tangram packages. To learn more about Tangram, [click here](https://www.tangram.dev).

## Scripts

Run the repository scripts with `tg run` from the repository:

- `tg run .#check` runs one `tg check` with every package.
- `tg run .#format` runs one `tg format` with every package.
- `tg run .#test` builds each package's default export and its `test` export.
- `tg run .#publish` publishes the packages in one `tg publish --force`, which also creates the builds that each package lists in its `builds` metadata.

Each script runs on every package unless arguments after `--` name packages, such as `tg run .#check -- jq ripgrep` or `tg run .#test -- ./packages/jq.tg.ts`. Arguments that start with `-` are passed to the `tg` subcommand, such as `tg run .#publish -- --dry-run` or `tg run .#test -- --retry jq`. Pass a flag's value with `=`, such as `--remote=name`.
