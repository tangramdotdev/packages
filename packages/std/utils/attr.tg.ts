import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import basenamePatch from "./attr_basename.patch" with { type: "file" };

export let metadata = {
	name: "attr",
	version: "2.5.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	let base = `https://mirrors.sarata.com/non-gnu/${name}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => std.patch(source, basenamePatch));
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

export let build = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		staticBuild = false,
		usePrerequisites = true,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	if (std.triple.os(host) !== "linux" || std.triple.os(build) !== "linux") {
		throw new Error(
			`Unsupported system: ${host}. The attr package is Linux-only.`,
		);
	}

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--with-pic",
		],
	};
	if (staticBuild) {
		configure.args.push("--enable-static");
		configure.args.push("--disable-shared");
	}

	let phases = { configure };

	let env: tg.Unresolved<std.Args<std.env.Arg>> = [env_];
	if (usePrerequisites) {
		env.push(prerequisites(build));
	}
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}

	let output = await buildUtil({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(env),
		phases,
		opt: staticBuild ? "s" : undefined,
		sdk,
		source: source_ ?? source(),
	});

	let bins = ["attr", "getfattr", "setfattr"];
	for (let bin of bins) {
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		let wrappedBin = std.wrap({
			buildToolchain: bootstrap.sdk(),
			executable: unwrappedBin,
			libraryPaths: [tg.symlink(tg`${output}/lib`)],
		});
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}
	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
