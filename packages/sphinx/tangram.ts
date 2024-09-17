import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

import * as python from "tg:python" with { path: "../python" };

export const metadata = {
	homepage: "https://www.sphinx-doc.org/en/master/",
	license: "BSD-2-Clause",
	name: "sphinx",
	repository: "https://github.com/sphinx-doc/sphinx",
	version: "7.0.1",
};

// Generated using pip-tools/pip-compile: https://pypi.org/project/pip-tools
import requirements from "./requirements.txt" with { type: "file" };

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:07615442c34dbbf1844d4b514c659c27a8fa14819d6999b920773aed798d00c9";
	const owner = "sphinx-doc";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "release",
		version,
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	python?: python.Arg;
	host?: string;
	source?: tg.Directory;
};

export const build = tg.target((arg?: Arg) => {
	const sourceArtifact = arg?.source ?? source();

	const pythonEnv = python.build(
		{
			...arg,
			source: sourceArtifact,
			python: { requirements },
		},
		arg?.python ?? [],
	);

	// Manual wrapping is required to avoid a conflict in PYTHONPATH.
	const sphinx = std.wrap({
		executable: tg.symlink(tg`${pythonEnv}/bin/python3.11`),
		args: ["-m", "sphinx"],
		env: {
			PYTHONPATH: tg.Mutation.suffix(
				tg`${sourceArtifact}:${pythonEnv}/lib/python3/site-packages`,
				":",
			),
		},
	});

	return tg.directory({
		bin: {
			sphinx,
		},
	});
});

export default build;

export const test = tg.target(async () => {
	return await $`
				sphinx --help
			`.env(build());
});
