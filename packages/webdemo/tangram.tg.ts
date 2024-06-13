import * as jq from "tg:jq@1.7.1";
import * as ripgrep from "tg:ripgrep";
import * as std from "tg:std";
export let env = tg.target(() => std.env(jq.build(), ripgrep.build()));
