import jq from "jq";
import ripgrep from "ripgrep";
import * as std from "std";

export const metadata = {
	name: "demo",
	version: "0.0.0",
};

export default async function demo() {
	return std.env(tg.build(jq), tg.build(ripgrep));
}
