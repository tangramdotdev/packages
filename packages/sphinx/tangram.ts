import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import * as python from "python" with { path: "../python" };

export const metadata = {
	homepage: "https://www.sphinx-doc.org/en/master/",
	license: "BSD-2-Clause",
	name: "sphinx",
	repository: "https://github.com/sphinx-doc/sphinx",
	version: "8.1.3",
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

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0fcc28999fe8e4fcc49a4ab01e3e987f6fbb3af32995db74e6fc8f8d01dcaaca";
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
});

export type Arg = {
	build?: string;
	python?: python.Arg;
	host?: string;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		python: pythonArg = {},
		host,
		source: source_,
	} = await std.args.apply<Arg>(...args);

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
});

export default build;
export const test = tg.target(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
