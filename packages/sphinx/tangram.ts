import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import * as python from "python" with { path: "../python" };

export const metadata = {
	homepage: "https://www.sphinx-doc.org/en/master/",
	license: "BSD-2-Clause",
	name: "sphinx",
	repository: "https://github.com/sphinx-doc/sphinx",
	version: "8.1.3",
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
	env?: std.env.Arg;
	python?: python.Arg;
	host?: string;
	source?: tg.Directory;
};

export const default_ = tg.target((arg?: Arg) => {
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

export default default_;

export const test = tg.target(async () => {
	return await $`
				sphinx --help
			`.env(default_());
});
