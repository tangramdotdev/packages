import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://openjdk.org",
	license: "https://openjdk.java.net/legal/gplv2+ce.html",
	name: "openjdk",
	repository: "https://github.com/openjdk/jdk",
	version: "24+2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let owner = name;
	let repo = "jdk";
	let tag = `jdk-${version}`;
	let checksum =
		"sha256:d137fbe34f311c677725a932d9b0b8d3d420f0493667f54f0d5e9e78e4b240e5";
	return std.download.fromGithub({ owner, repo, tag, checksum, source: "tag" });
});
