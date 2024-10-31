import * as python from "python" with { path: "../python" };
import * as std from "std" with { path: "../std" };

import requirementsTxt from "./requirements.txt" with { type: "file" };

export const metadata = {
	homepage: "https://pypi.org/project/docformatter/",
	name: "docformatter",
	license: "MIT",
	repository: "https://github.com/PyCQA/docformatter",
	version: "1.7.5",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:d35de4c83b78172bf618500a8b0e9075378ec41aa4a71b28f2f633a60668b3ab";
	const owner = "PyCQA";
	const repo = name;
	const tag = `v${version}`;
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
	host?: string;
	python?: python.Arg;
	requirements?: tg.File;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		python: pythonArg = {},
		requirements: requirements_,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	const requirements = requirements_ ?? requirementsTxt;

	return python.build(
		{
			build,
			source: source_ ?? (await source()),
			host,
			python: { requirements },
		},
		pythonArg,
	);
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		binaries: ["docformatter"],
		metadata,
	});
	return true;
});
