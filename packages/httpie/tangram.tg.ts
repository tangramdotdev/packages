import * as python from "tg:python" with { path: "../python" };
import * as std from "tg:std" with { path: "../std" };

import requirements from "./requirements.txt" with { type: "file" };
import pyprojectToml from "./pyproject.toml" with { type: "file" };

export let metadata = {
	homepage: "https://httpie.io",
	license: "BSD-3-Clause",
	name: "httpie",
	repository: "https://github.com/httpie/cli",
	version: "3.2.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:01b4407202fac3cc68c73a8ff1f4a81a759d9575fabfad855772c29365fe18e6";
	let owner = name;
	let repo = name;
	let tag = version;

	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

type Arg = {
	build?: string;
	env?: std.env.Arg;
	python?: python.Arg;
	host?: string;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let sourceArtifact = arg?.source ?? (await source());
	let main = await sourceArtifact.get("httpie/__main__.py");

	let host = arg?.host ?? (await std.triple.host());
	let build_ = arg?.build ?? host;

	let build = python.build(
		{
			build: build_,
			source: sourceArtifact,
			pyprojectToml,
			python: { requirements },
			host,
		},
		arg?.python ?? [],
	);

	return build;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["http", "https", "httpie"],
		metadata,
	});
	return true;
});
