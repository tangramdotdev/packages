import * as poetry from "poetry" with { path: "../poetry" };
import * as std from "std" with { path: "../std" };
import poetryLock from "./poetry.lock" with { type: "file" };

export const metadata = {
	homepage: "https://pypi.org/project/docformatter/",
	name: "docformatter",
	license: "MIT",
	repository: "https://github.com/PyCQA/docformatter",
	version: "1.7.2",
};

export const source = tg.target(() => {
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
});

type Arg = {
	source?: tg.Directory;
	host?: string;
	target?: string;
};

export const default_ = tg.target(async (arg?: Arg) => {
	let host = arg?.host ?? (await std.triple.host());
	let target = arg?.target ?? host;
	return poetry.build({
		source: arg?.source ?? source(),
		lockfile: poetryLock,
		host,
		target,
	});
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
