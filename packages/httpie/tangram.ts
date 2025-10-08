import * as python from "python" with { local: "../python" };
import * as std from "std" with { local: "../std" };

import requirements from "./requirements.txt" with { type: "file" };
import pyprojectToml from "./pyproject.toml" with { type: "file" };

export const metadata = {
	homepage: "https://httpie.io",
	license: "BSD-3-Clause",
	name: "httpie",
	repository: "https://github.com/httpie/cli",
	version: "3.2.3",
	tag: "httpie/3.2.3",
	provides: {
		binaries: ["http", "https", "httpie"],
	},
};

export const source = async () => {
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
};

type Arg = {
	build?: string;
	python?: python.BuildArg;
	host?: string;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build,
		python: pythonArg = {},
		host,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceArtifact = source_ ?? (await source());

	return python.build(
		{
			build,
			source: sourceArtifact,
			pyprojectToml,
			python: { requirements },
			host,
		},
		pythonArg,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
