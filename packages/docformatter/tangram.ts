import * as poetry from "poetry" with { source: "../poetry" };
import * as std from "std" with { source: "../std" };
import untokenizeModule from "./untokenize.py" with { type: "file" };

export const metadata = {
	homepage: "https://pypi.org/project/docformatter/",
	name: "docformatter",
	license: "MIT",
	repository: "https://github.com/PyCQA/docformatter",
	version: "1.7.8",
	tag: "docformatter/1.7.8",
	provides: {
		binaries: ["docformatter"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:96627a39134bc6e1811f534ff19806572aa1888da1d029b45c11854478eebd1a";
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
}

type Arg = {
	build?: string;
	host?: string;
	source?: tg.Directory;
};

export async function build(...args: std.Args<Arg>) {
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
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
