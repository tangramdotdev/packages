import * as python from "python" with { source: "./python" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://pycqa.github.io/isort/",
	license: "MIT",
	name: "isort",
	repository: "https://github.com/PyCQA/isort",
	version: "8.0.1",
	tag: "isort/8.0.1",
	provides: {
		binaries: ["isort"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:7693717d79f0f85057c6fbfd576699547644b535a06aba57d512a30838a6ba2e";
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
}

export type Arg = std.args.BasePackageArg;

export async function build(...args: tg.Args<Arg>) {
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
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
