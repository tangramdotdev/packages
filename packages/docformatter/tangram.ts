import * as poetry from "poetry" with { local: "../poetry" };
import * as std from "std" with { local: "../std" };
import untokenizeModule from "./untokenize.py" with { type: "file" };

export const metadata = {
	homepage: "https://pypi.org/project/docformatter/",
	name: "docformatter",
	license: "MIT",
	repository: "https://github.com/PyCQA/docformatter",
	version: "1.7.7",
	tag: "docformatter/1.7.7",
	provides: {
		binaries: ["docformatter"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6d76165e3a52384ed982889672751bf3d96f3126b57c47c04f66925b35dd7374";
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
};

type Arg = {
	build?: string;
	host?: string;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	// Exclude untokenize from pip requirements - it can't build on Python 3.14.
	// Vendor it as a pure Python module instead.
	return poetry.build({
		build,
		source: source_ ?? (await source()),
		host,
		exclude: ["untokenize"],
		sitePackages: { "untokenize.py": untokenizeModule },
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
