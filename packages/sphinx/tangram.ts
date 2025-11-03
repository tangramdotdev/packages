import * as std from "std" with { local: "../std" };

import * as python from "python" with { local: "../python" };

export const metadata = {
	homepage: "https://www.sphinx-doc.org/en/master/",
	license: "BSD-2-Clause",
	name: "sphinx",
	repository: "https://github.com/sphinx-doc/sphinx",
	version: "8.2.3",
	tag: "sphinx/8.2.3",
	provides: {
		binaries: [
			"sphinx-apidoc",
			"sphinx-autogen",
			"sphinx-build",
			"sphinx-quickstart",
		],
	},
};

// Generated using pip-tools/pip-compile: https://pypi.org/project/pip-tools
import requirements from "./requirements.txt" with { type: "file" };

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:94cd09fa065b819dcc40de329441d53710cf51f6857b39ce20840bb2b5d3ec78";
	const owner = "sphinx-doc";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "tag",
	});
};

export type Arg = {
	build?: string;
	python?: python.Arg;
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
			host,
			source: sourceArtifact,
			python: { requirements },
		},
		pythonArg,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
