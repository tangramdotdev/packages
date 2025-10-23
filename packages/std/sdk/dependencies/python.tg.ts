import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	name: "Python",
	version: "3.14.0",
	tag: "Python/3.14.0",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:2299dae542d395ce3883aca00d3c910307cd68e0b2f7336098c8e7b7eee9f3e9";
	const base = `https://www.python.org/ftp/python/${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	const os = std.triple.os(build);

	const configureArgs = [
		"--disable-test-modules",
		"--with-ensurepip=no",
		"--without-c-locale-coercion",
		"--without-readline",
	];
	const makeArgs = [];

	const envs: Array<tg.Unresolved<std.env.Arg>> = [];
	if (os === "darwin") {
		envs.push({ MACOSX_DEPLOYMENT_TARGET: "15.2" });
		configureArgs.push(
			"DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
		makeArgs.push(
			"RUNSHARED=DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
	}

	const env = await std.env.arg(...envs, env_, { utils: false });
	const providedCc = await std.env.tryGetKey({ env, key: "CC" });
	if (providedCc) {
		configureArgs.push(`CC="$CC"`);
	}

	const configure = { args: configureArgs };
	const buildPhase = { args: makeArgs };
	const install = { args: makeArgs };
	const phases = { configure, build: buildPhase, install };

	// Build python.
	const result = std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env,
		phases,
		sdk,
		setRuntimeLibraryPath: true,
		source: source_ ?? source(),
	});

	return result;
};

export default build;

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["python3"], metadata });
	return true;
};
