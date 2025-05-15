import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	name: "Python",
	version: "3.13.3",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:40f868bcbdeb8149a3149580bb9bfd407b3321cd48f0be631af955ac92c0e041";
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

	const configure = {
		args: [
			"--disable-test-modules",
			"--with-ensurepip=no",
			"--without-c-locale-coercion",
			"--without-readline",
		],
	};

	const phases = { configure };

	const env = await std.env.arg(env_, { utils: false });
	const providedCc = await std.env.tryGetKey({ env, key: "CC" });
	if (providedCc) {
		configure.args.push(`CC="$CC"`);
	}

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
