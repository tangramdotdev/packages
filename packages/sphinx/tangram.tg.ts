import * as std from "tg:std" with { path: "../std" };

import * as python from "tg:python" with { path: "../python" };

export let metadata = {
	name: "sphinx",
	version: "7.0.1",
};

// Generated using pip-tools/pip-compile: https://pypi.org/project/pip-tools
import requirements from "./requirements.txt" with { type: "file" };

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:07615442c34dbbf1844d4b514c659c27a8fa14819d6999b920773aed798d00c9";
	let owner = "sphinx-doc";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "release",
		version,
	});
});

type Arg = {
	build?: string;
	env?: std.env.Arg;
	python?: tg.MaybeNestedArray<python.Arg>;
	host?: string;
	source?: tg.Directory;
};

export let sphinx = tg.target((arg?: Arg) => {
	let sourceArtifact = arg?.source ?? source();

	let pythonEnv = python.build(
		{
			...arg,
			source: sourceArtifact,
			python: { requirements },
		},
		arg?.python ?? [],
	);

	// Manual wrapping is required to avoid a conflict in PYTHONPATH.
	let sphinx = std.wrap({
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

export default sphinx;

export let test = tg.target(() => {
	return std.build(
		tg`
				sphinx --help
			`,
		{ env: sphinx() },
	);
});
