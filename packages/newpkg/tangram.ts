import * as autobuild from "/Users/benlovy/code/packages/packages/autobuild";
import * as std from "std";
import source from "." with { type: "directory" };
export default tg.target(() => autobuild.default({ env: env(), source }));
export const env = tg.target(() => std.env(autobuild.env({ source })));
