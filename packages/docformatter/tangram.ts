import * as poetry from "poetry" with { local: "../poetry" };
import * as std from "std" with { local: "../std" };
import poetryLock from "./poetry.lock" with { type: "file" };

export const metadata = {
	homepage: "https://pypi.org/project/docformatter/",
	name: "docformatter",
	license: "MIT",
	repository: "https://github.com/PyCQA/docformatter",
	version: "1.7.2",
	provides: {
		binaries: ["docformatter"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8c4a509f77261c05e093f6268bedd36a2782c0d6ccc01d62d1ddf3a46835aa98";
	const owner = "PyCQA";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
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

	return poetry.build({
		build,
		source: source_ ?? (await source()),
		lockfile: poetryLock,
		host,
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
