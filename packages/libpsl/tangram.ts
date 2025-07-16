import * as std from "std" with { local: "../std" };
import python from "python" with { local: "../python" };

export const metadata = {
	homepage: "https://rockdaboot.github.io/libpsl/",
	license: "MIT",
	name: "libpsl",
	repository: "https://github.com/rockdaboot/libpsl",
	version: "0.21.5",
	provides: {
		libraries: ["psl"],
	},
};

export const source = async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:1dcc9ceae8b128f3c0b3f654decd0e1e891afc6ff81098f227ef260449dae208";
	const owner = "rockdaboot";
	const repo = name;
	const tag = version;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-nls", "--disable-rpath"],
	};

	const env = std.env.arg(python({ host: build }), env_);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
