import * as autoconf from "tg:autoconf" with { path: "../autoconf" };
import * as bash from "tg:bash" with { path: "../bash" };
import * as cmake from "tg:cmake" with { path: "../cmake" };
import * as git from "tg:git" with { path: "../git" };
import * as go from "tg:go" with { path: "../go" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.cockroachlabs.com",
	name: "cockroachdb",
	repository: "https://github.com/cockroachdb/cockroach",
	version: "24.1.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let owner = "cockroachdb";
	let repo = "cockroach";
	let tag = `v${version}`;
	let checksum =
		"sha256:c6d0cd58edff330c587534de5c9ca043b7c6e298cfc67c7fba6bea6f23a7f3c4";
	return std.download.fromGithub({ checksum, owner, repo, tag, source: "tag" });
});

export let build = tg.target(async () => {
	return true;
});

export default build;
