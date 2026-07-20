import * as std from "std" with { source: "../std" };

import * as python from "python" with { source: "../python" };

export const metadata = {
	homepage: "https://www.sphinx-doc.org/en/master/",
	license: "BSD-2-Clause",
	name: "sphinx",
	repository: "https://github.com/sphinx-doc/sphinx",
	version: "9.1.0",
	tag: "sphinx/9.1.0",
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

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:fc64c3d18fe9614fec5dddb3eff0b74c5f0a73ff244e03e129d7d8862ac00815";
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
}

export type Arg = std.args.BasePackageArg;

export async function build(...args: std.Args<Arg>) {
	const {
		build,
		host,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceArtifact = source_ ?? (await source());

	return python.build({
		build,
		host,
		source: sourceArtifact,
		python: { requirements },
	});
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
