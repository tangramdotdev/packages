import autobuild from "/Users/benlovy/code/packages/packages/autobuild";
import source from "." with { type: "directory" };
export default tg.target(() => autobuild({ source }));
