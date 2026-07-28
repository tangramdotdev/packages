import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	name: "Python",
	version: "3.14.6",
	tag: "Python/3.14.6",
};

export async function source() {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:143b1dddefaec3bd2e21e3b839b34a2b7fb9842272883c576420d605e9f30c63";
	const base = `https://www.python.org/ftp/python/${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	// Resolve args first to access build/host for OS detection.
	const resolved = await std.autotools.arg({ source: source() }, ...args);
	const host = resolved.host ?? std.triple.host();
	const build = resolved.build ?? host;
	const os = std.triple.os(build);

	const configureArgs = [
		"--disable-test-modules",
		"--with-ensurepip=no",
		"--without-c-locale-coercion",
		"--without-readline",
	];
	const makeArgs: Array<string> = [];

	const envs: tg.Args<std.env.Arg> = [];
	if (os === "darwin") {
		envs.push({ MACOSX_DEPLOYMENT_TARGET: std.sdk.macOsDeploymentTarget });
		configureArgs.push(
			"DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
			"ax_cv_c_float_words_bigendian=no",
		);
		makeArgs.push(
			"RUNSHARED=DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
	}

	const env = await std.env.arg(...envs, resolved.env ?? null, {
		utils: false,
	});
	const providedCc = await std.env.tryGetKey({ env, key: "CC" });
	if (providedCc) {
		configureArgs.push(`CC="$CC"`);
	}

	return std.autotools.build({
		...resolved,
		env,
		phases: {
			configure: { args: configureArgs },
			build: { args: makeArgs },
			install: { args: makeArgs },
		},
		setRuntimeLibraryPath: true,
	});
}

export default build;

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["python3"], metadata });
	return true;
}
