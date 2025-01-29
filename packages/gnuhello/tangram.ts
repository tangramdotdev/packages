import gettext from "gettext" with { path: "../gettext" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/hello/",
	license: "GPL-3.0-or-later",
	name: "hello",
	repository: "https://git.savannah.gnu.org/cgit/hello.git",
	version: "2.12.1",
	provides: {
		binaries: ["hello"],
	},
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
	dependencies?: {
		libiconv?: libiconv.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { libiconv: libiconvArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const dependencies: Array<tg.Unresolved<std.env.Arg>> = [
		gettext({ build, host: build }),
	];

	if (std.triple.os(host) === "darwin") {
		dependencies.push(
			libiconv.build({ build, env: env_, host, sdk }, libiconvArg),
		);
	}

	const env = std.env.arg(...dependencies, env_);

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
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
