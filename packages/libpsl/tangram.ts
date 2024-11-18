import * as std from "std" with { path: "../std" };
import python from "python" with { path: "../python" };

export const metadata = {
	homepage: "https://rockdaboot.github.io/libpsl/",
	license: "MIT",
	name: "libpsl",
	repository: "https://github.com/rockdaboot/libpsl",
	version: "0.21.5",
};

export const source = tg.target(async (): Promise<tg.Directory> => {
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
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = [],
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

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
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({ buildFn: default_, libraries: ["psl"] });
	return true;
});
