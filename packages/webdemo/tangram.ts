import * as jq from "jq";
import * as std from "std";
export default tg.target(() => std.env(jq.build()));
