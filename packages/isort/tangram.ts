import * as poetry from "poetry" with { path: "../poetry" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://pycqa.github.io/isort/",
	license: "MIT",
	name: "isort",
	repository: "https://github.com/PyCQA/isort",
	version: "5.13.2",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0f13e665483ca8cfa3d3e1809738ea518f8a66fe5489430273f08368893193e1";
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
});

export type Arg = {
	build?: string;
	host?: string;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const { build, host, source: source_ } = await std.args.apply<Arg>(...args);
	const sourceArtifact = source_ ?? (await source());
	const lockfile = tg.File.expect(await sourceArtifact.get("poetry.lock"));

	return poetry.build({
		source: sourceArtifact,
		lockfile: lockfile,
		build,
	});
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		binaries: ["isort"],
		metadata,
	});
	return true;
});
