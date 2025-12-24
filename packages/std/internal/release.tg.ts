// Canonical exports for release consistency.
// Both tangram.ts and internal consumers (like env.tg.ts) should import
// from here to ensure cache hits. When releases are built from the tag
// (e.g., std/0.0.0#gnuEnv), the module referents will match those used
// by consumers calling std.env().

export { gnuEnv } from "../utils/coreutils.tg.ts";
export { defaultEnv } from "../utils.tg.ts";
export { injection as wrapInjection } from "../wrap/injection.tg.ts";
export { defaultInjection as wrapDefaultInjection } from "../wrap/injection.tg.ts";
export { workspace as wrapWorkspace } from "../wrap/workspace.tg.ts";
export { defaultWrapper as wrapDefaultWrapper } from "../wrap/workspace.tg.ts";
export { autotoolsBuildTools } from "../sdk/dependencies.tg.ts";
