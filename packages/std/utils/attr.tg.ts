import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import basenamePatch from "./attr_basename.patch" with { type: "file" };

export const metadata = {
	name: "attr",
	version: "2.5.2",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	const base = `https://download.savannah.gnu.org/releases/${name}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, basenamePatch));
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	staticBuild?: boolean;
	usePrerequisites?: boolean;
};

export const build = tg.target(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		staticBuild = false,
		usePrerequisites = true,
	} = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	if (std.triple.os(host) !== "linux" || std.triple.os(build) !== "linux") {
		throw new Error(
			`Unsupported system: ${host}. The attr package is Linux-only.`,
		);
	}

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-silent-rules",
			"--disable-nls",
			"--disable-rpath",
			"--with-pic",
		],
	};
	if (staticBuild) {
		configure.args.push("--enable-static");
		configure.args.push("--disable-shared");
	}

	const sourceDir = source_ ?? source();

	const phases = { configure };

	const env: tg.Unresolved<std.Args<std.env.Arg>> = [env_];
	if (usePrerequisites) {
		env.push(prerequisites(build));
	}
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}

	return buildUtil({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(env),
		phases,
		opt: staticBuild ? "s" : undefined,
		sdk,
		source: sourceDir,
	});
});

export default build;

export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
