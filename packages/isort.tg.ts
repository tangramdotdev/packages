import * as python from "python" with { local: "./python" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://pycqa.github.io/isort/",
	license: "MIT",
	name: "isort",
	repository: "https://github.com/PyCQA/isort",
	version: "8.0.0",
	tag: "isort/8.0.0",
	provides: {
		binaries: ["isort"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0c6f8dc203df5d4d16c94fc3607299940026c3f5a1751e94fe23bbdb35280145";
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

export type Arg = std.args.BasePackageArg;

export const build = async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return python.build({
		build,
		host,
		source: source_ ?? (await source()),
		version: metadata.version,
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
