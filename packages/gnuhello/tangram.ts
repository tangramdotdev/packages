import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/hello/",
	license: "GPL-3.0-or-later",
	name: "hello",
	repository: "https://git.savannah.gnu.org/cgit/hello.git",
	version: "2.12.1",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8d99142afd92576f30b0cd7cb42a8dc6809998bc5d607d88761f512e26c7db20";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export const test = tg.target(async () => {
	return await $`
		mkdir -p $OUTPUT
		echo "Checking that we can run gnu hello."
		${build()}/bin/hello
	`;
});
