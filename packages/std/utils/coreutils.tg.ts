import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import attr from "./attr.tg.ts";
import { macOsXattrCmds } from "./file_cmds.tg.ts";
import libiconv from "./libiconv.tg.ts";
import alwaysPreserveXattrsPatch from "./coreutils-always-preserve-xattrs.patch" with {
	type: "file",
};
import { buildBootstrap } from "../command.tg.ts";

export const metadata = {
	name: "coreutils",
	version: "9.6",
};

export const source = tg.command(async (os: string) => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7a0124327b398fd9eb1a6abde583389821422c744ffa10734b24f557610d3283";
	let source = await std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});

	// Apply xattr patch on Linux.
	if (os === "linux") {
		const patches = [];
		patches.push(alwaysPreserveXattrsPatch);
		source = await bootstrap.patch(source, ...patches);
	}

	return source;
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

export const build = tg.command(async (arg?: Arg) => {
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
	const os = std.triple.os(host);

	const dependencies: tg.Unresolved<std.Args<std.env.Arg>> = [];

	if (usePrerequisites) {
		dependencies.push(prerequisites(build));
	}

	let attrArtifact;
	if (os === "linux") {
		attrArtifact = attr({
			build,
			env: env_,
			host,
			sdk,
			staticBuild,
			usePrerequisites,
		});
		dependencies.push(attrArtifact);
	} else if (os === "darwin") {
		dependencies.push(
			libiconv({
				build,
				env: env_,
				host,
				sdk,
				usePrerequisites,
			}),
		);
	}
	const env = [...dependencies, { FORCE_UNSAFE_CONFIGURE: true }];
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}
	env.push(env_);

	const configure = {
		args: [
			"--disable-acl",
			"--disable-dependency-tracking",
			"--disable-libcap",
			"--disable-nls",
			"--disable-rpath",
			"--enable-single-binary=symlinks",
			"--enable-single-binary-exceptions=env",
		],
	};

	let output = await autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(env),
		phases: { configure },
		opt: staticBuild ? "s" : undefined,
		sdk,
		source: source_ ?? source(os),
	});

	// On macOS, replace `install` with the Apple Open Source version that correctly handles xattrs.
	if (os === "darwin") {
		output = await tg.directory(
			output,
			{ "bin/install": undefined },
			macOsXattrCmds(arg),
		);
	}

	return output;
});

export default build;

/** Obtain just the `env` binary. */
export const gnuEnv = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const os = std.triple.os(host);
	const sdk = bootstrap.sdk(host);
	const env = std.env.arg(sdk, bootstrap.make.build({ host }));
	const directory = await build({
		host,
		env,
		sdk: false,
		staticBuild: os === "linux",
		usePrerequisites: false,
	});
	const exe = tg.File.expect(await directory.get("bin/env"));
	return exe;
});

/** This test asserts that this installation of coreutils preserves xattrs when using both `cp` and `install` on Linux. */

export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);
	const sdk = await bootstrap.sdk(host);

	const coreutils = await build({ host, sdk: false, env: sdk });

	let expected;
	let script;
	if (os === "linux") {
		script = tg`
			env
			log() {
				echo "$1" | tee -a "$OUTPUT"
			}

			echo "test file!" > test-file.txt

			log "Setting xattrs..."
			setfattr -n user.tangram -v "test value" test-file.txt

			log "Getting xattrs from original file:"
			log "$(getfattr -n user.tangram test-file.txt)"

			log "Copying file with cp..."
			mkdir fake-prefix-cp
			cp test-file.txt fake-prefix-cp/
			log "Getting xattrs from copied file:"
			log "$(getfattr -n user.tangram fake-prefix-cp/test-file.txt)"

			log "Copying file with install..."
			mkdir fake-prefix-install
			install test-file.txt fake-prefix-install/
			log "Getting xattrs from installed file:"
			log "$(getfattr -n user.tangram fake-prefix-install/test-file.txt)"
		`;
		expected = `Setting xattrs...\nGetting xattrs from original file:\n# file: test-file.txt\nuser.tangram="test value"\nCopying file with cp...\nGetting xattrs from copied file:\n# file: fake-prefix-cp/test-file.txt\nuser.tangram="test value"\nCopying file with install...\nGetting xattrs from installed file:\n# file: fake-prefix-install/test-file.txt\nuser.tangram="test value"`;
	} else if (os === "darwin") {
		script = tg`
			log() {
				echo "$1" | tee -a "$OUTPUT"
			}

			echo "test file!" > test-file.txt

			log "Setting xattrs..."
			xattr -w user.tangram "test value" test-file.txt

			log "Getting xattrs from original file:"
			log "$(xattr -p user.tangram test-file.txt)"

			log "Copying file with cp..."
			mkdir fake-prefix-cp
			cp test-file.txt fake-prefix-cp/
			log "Getting xattrs from copied file:"
			log "$(xattr -p user.tangram fake-prefix-cp/test-file.txt)"

			log "Copying file with install..."
			mkdir fake-prefix-install
			install test-file.txt fake-prefix-install/
			log "Getting xattrs from installed file:"
			log "$(xattr -p user.tangram fake-prefix-install/test-file.txt)"
		`;
		expected = `Setting xattrs...\nGetting xattrs from original file:\ntest value\nCopying file with cp...\nGetting xattrs from copied file:\ntest value\nCopying file with install...\nGetting xattrs from installed file:\ntest value`;
	} else {
		return tg.unreachable();
	}

	// Run the script.
	const platformSupportLib =
		os === "darwin"
			? libiconv({ host, sdk: false, env: sdk })
			: attr({ host, sdk: false, env: sdk });
	const output = tg.File.expect(
		await buildBootstrap(
			await tg.command(script, {
				env: std.env.arg(platformSupportLib, coreutils),
			}),
		),
	);

	const contents = (await output.text()).trim();
	tg.assert(contents === expected);
	return coreutils;
});
