import * as poetry from "poetry" with { local: "../poetry" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://pycqa.github.io/isort/",
	license: "MIT",
	name: "isort",
	repository: "https://github.com/PyCQA/isort",
	version: "7.0.0",
	tag: "isort/7.0.0",
	provides: {
		binaries: ["isort"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:37bd95273056dfd6583d31659e56bc5b34e0ce82f9c5aa923c0e667ce9ba5caa";
	const owner = "PyCQA";
	const repo = name;
	const tag = version;

	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
};

export type Arg = {
	build?: string;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const { build, source: source_ } = await std.packages.applyArgs<Arg>(...args);
	const sourceArtifact = source_ ?? (await source());
	const lockfile = tg.File.expect(await sourceArtifact.get("poetry.lock"));

	return poetry.build({
		source: sourceArtifact,
		lockfile: lockfile,
		build,
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
