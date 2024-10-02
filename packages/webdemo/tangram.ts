import jq from "jq";
import sqlite from "sqlite";
import * as std from "std";
export default tg.target(() => std.env(jq(), sqlite()));
