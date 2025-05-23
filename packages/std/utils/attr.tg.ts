import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import basenamePatch from "./attr_basename.patch" with { type: "file" };

export const metadata = {
	name: "attr",
	version: "2.5.2",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	const base = `https://download.savannah.gnu.org/releases/${name}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, basenamePatch));
};

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	staticBuild?: boolean;
	usePrerequisites?: boolean;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		staticBuild = false,
		usePrerequisites = true,
	} = arg ? await tg.resolve(arg) : {};

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

	const env: Array<tg.Unresolved<std.env.Arg>> = [env_];
	if (usePrerequisites) {
		env.push(prerequisites(build));
	}
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}

	return autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env: std.env.arg(...env, { utils: false }),
		phases,
		opt: staticBuild ? "s" : undefined,
		sdk,
		source: sourceDir,
	});
};

export default build;

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, bootstrap: true, env: sdk });
};
