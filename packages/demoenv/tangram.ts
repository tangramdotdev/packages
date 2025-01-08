import * as std from "std";
import jq from "jq";
export default tg.target(() => std.env(jq()));
