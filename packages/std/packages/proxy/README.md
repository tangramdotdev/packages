# Wrapper and proxy controls

Controls belong to one component. Both `--tg-COMPONENT-OPTION` and
`--tangram-COMPONENT-OPTION` are accepted; prefer `--tg-` in callers.
The environment key is `TANGRAM_COMPONENT_OPTION` (uppercase, underscores).
Names are case-sensitive. There are no `TG_` environment aliases.

| Component | Option | Value / default |
| --- | --- | --- |
| wrapper | suppress-args | Boolean / false; retain manifest arguments. |
| wrapper | suppress-env | Boolean / false; apply manifest environment. |
| wrapper | print-manifest | Boolean / false; print and exit when true. |
| linker | passthrough | Boolean / false; skip output processing. |
| linker | disallow-missing-libraries | Boolean / false; reject unresolved libraries during verification. |
| linker | embed-wrapper | Boolean / false; SDK default true on Linux, false on macOS. |
| linker | library-path-strategy | none, filter, resolve, isolate (default), combine; case-insensitive. |
| linker | library-search-depth | Nonnegative decimal usize / 16. |
| linker | wrapper-args | Inline array of `tg.template(...)` values / absent. |
| linker | wrapper-env | Inline `tg.mutation(...)`, outer set of a map or unset / absent. |
| strip | passthrough | Boolean / false; skip wrapper rewriting. |

Booleans accept bare CLI flags as true, or `=true`, `=false`, `=1`, `=0`.
Boolean values are case-insensitive, without whitespace; empty values are errors.
Other controls require `=VALUE`. Defaults apply first, then environment, then
CLI occurrences in order. The last occurrence wins across aliases, replacing
whole payloads. Every value is validated even when overridden. SDK configurable
defaults use `setIfUnset`; callers disabling a control must use `"false"` or `"0"`
because `std.env` serializes boolean false as an empty string.

Only exact owned names are consumed. Foreign, retired, and unknown names pass
through. The first `--` in an option position and all following words pass
through. Native operands are data, including operands that look like controls
or delimiters. Response files are forwarded without expansion. Wrapper manifest
arguments configure children and are never parsed by the current wrapper.
CLI overrides do not change inherited environment controls for later wrappers.

Pass linker controls through compiler drivers:

```sh
cc main.c -Wl,--tg-linker-library-path-strategy=combine
cc main.c -Xlinker '--tg-linker-wrapper-args=[tg.template(["hello, world=1"])]'
cc main.c -Xlinker '--tg-linker-wrapper-env=tg.mutation({"kind":"set","value":{"EXAMPLE":"hello, world=1"}})'
```

Use `-Xlinker` with a single quoted word for payloads containing commas because
`-Wl,` splits commas. Arguments must be templates, not strings. Environment
entries support scalars, artifacts, templates, and runtime-supported per-key
mutations (set, set_if_unset, append/prepend of strings, prefix/suffix of
templates, unset). Arrays, nested maps, bytes, modules, placeholders, and merge
mutations cannot be rendered. `[]` supplies no manifest arguments, a set of an
empty map changes no environment entries, and outer unset clears the environment.
Artifact subpaths use an artifact root plus a string suffix. Ordinary strings
remain literal. Payload errors never include the value or its authorization tokens.

Environment-only configuration uses `TANGRAM_LINKER_COMMAND_PATH`,
`TANGRAM_LINKER_INTERPRETER_PATH`, `TANGRAM_LINKER_INTERPRETER_ARGS`,
`TANGRAM_LINKER_INJECTION_PATH`, `TANGRAM_LINKER_TRACING`,
`TANGRAM_STRIP_COMMAND_PATH`, `TANGRAM_STRIP_RUNTIME_LIBRARY_PATH`, and
`TANGRAM_STRIP_TRACING`. Linker and strip tracing use Rust target filters.
`TANGRAM_WRAPPER_TRACING` uses the boolean grammar. `TGCC_ENABLE` also uses the
boolean grammar, default false. Other compiler controls and dispatch markers
retain their names. `TANGRAM_ENV_` is reserved for sandbox transport.

## Adding a component

`proxy::options::Session` performs no I/O or environment mutation. Declare an ID,
suffix, and kind once, then pass initialized settings, an environment lookup,
and an application callback. Validate specialized text in that callback and use
`Source::invalid` to report an expected type without exposing the payload.
Namespaces `wrapper`, `linker`, and `strip` belong to their respective consumers;
`rustc` is reserved for future tgrustc controls.

```rust,ignore
let declarations = [Declaration { id: Id::Enabled, kind: Kind::Boolean, suffix: "enabled" }];
let mut session = Session::new("example", &declarations, Settings::default(), std::env::var_os, apply)?;
let mut args = std::env::args_os().skip(1);
while let Some(arg) = args.next() {
    if session.consume(&arg)? { continue; }
    let takes_operand = !session.ended() && arg == "-o";
    forwarded.push(arg);
    if takes_operand {
        if let Some(operand) = args.next() { forwarded.push(operand); }
    }
}
let settings = session.into_settings();
```

Run any dispatch first and exclude leading protocol arguments. A future tgrustc
consumer must also exclude the real rustc executable argument after dispatch.
The C runtime wrapper independently implements the same contract.
