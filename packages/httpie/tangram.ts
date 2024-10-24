import * as python from "python" with { path: "../python" };
import * as std from "std" with { path: "../std" };

import requirements from "./requirements.txt" with { type: "file" };
import pyprojectToml from "./pyproject.toml" with { type: "file" };

export const metadata = {
	homepage: "https://httpie.io",
	license: "BSD-3-Clause",
	name: "httpie",
	repository: "https://github.com/httpie/cli",
	version: "3.2.3",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:91cb6cbd1f9e6115ffc13824e87b2a4d903d76c769859e81924913adbf609c1b";
	const owner = name;
	const repo = name;
	const tag = version;

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
	python?: python.BuildArg;
	host?: string;
	source?: tg.Directory;
};

export const default_ = tg.target(async (arg?: Arg) => {
	const sourceArtifact = arg?.source ?? (await source());
	const main = await sourceArtifact.get("httpie/__main__.py");

	const host = arg?.host ?? (await std.triple.host());
	const build_ = arg?.build ?? host;

	const build = python.build(
		{
			build: build_,
			source: sourceArtifact,
			pyprojectToml,
			python: { requirements },
			host,
		},
		arg?.python ?? {},
	);

	return build;
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		binaries: ["http", "https", "httpie"],
		metadata,
	});
	return true;
});
