import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import attr from "./attr.tg.ts";
import { macOsXattrCmds } from "./file_cmds.tg.ts";
import libiconv from "./libiconv.tg.ts";
import alwaysPreserveXattrsPatch from "./coreutils-always-preserve-xattrs.patch" with { type: "file" };

export const metadata = {
	name: "coreutils",
	version: "9.10",
	tag: "coreutils/9.10",
};

export const source = async (os: string) => {
	const { name, version } = metadata;
	const checksum =
		"sha256:16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25";
	let source = await std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});

	// Apply xattr patch on Linux. The gnulib xattr module only supports Linux's
	// libattr (attr/xattr.h), not macOS's native sys/xattr.h, so this patch
	// only works on Linux. On macOS, cp and install are replaced with Apple's
	// file_cmds versions which preserve xattrs natively.
	if (os === "linux") {
		const patches = [];
		patches.push(alwaysPreserveXattrsPatch);
		source = await bootstrap.patch(source, ...patches);
	}

	return source;
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
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;
	const os = std.triple.os(host);

	const dependencies: std.Args<std.env.Arg> = [];

	if (usePrerequisites) {
		dependencies.push(prerequisites(build));
	}

	let attrArtifact;
	if (os === "linux") {
		attrArtifact = attr({
			bootstrap: bootstrap_,
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
				bootstrap: bootstrap_,
				build,
				env: env_,
				host,
				sdk,
				usePrerequisites,
			}),
		);
	}

	// On macOS, build Apple xattr-preserving cp and install.
	let appleXattrCmds: ReturnType<typeof macOsXattrCmds> | undefined;
	if (os === "darwin") {
		appleXattrCmds = macOsXattrCmds({
			env: env_ ?? bootstrap.sdk(host),
		});
	}
	const env = [...dependencies, { FORCE_UNSAFE_CONFIGURE: true }];
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}
	env.push(env_);
	if (os === "darwin" && appleXattrCmds) {
		env.push(appleXattrCmds);
	}

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

	// On macOS, override INSTALL on the make install command line.
	const phases: std.phases.PhasesArg = { configure };
	if (os === "darwin") {
		phases.install = "make install 'INSTALL=install -c'";
	}

	let output = await autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		env: std.env.arg(...env, { utils: false }),
		phases,
		processName: metadata.name,
		opt: staticBuild ? "s" : undefined,
		sdk,
		source: source_ ?? source(os),
	});

	// On macOS, replace `cp` and `install` with Apple versions in the output.
	if (os === "darwin") {
		output = await tg.directory(
			output,
			{ "bin/cp": undefined, "bin/install": undefined },
			appleXattrCmds,
		);
	}

	return output;
};

export default build;

/** Build bootstrap coreutils with consistent, normalized args. This is the shared entry point used by both gnuEnv() and prerequisites() to ensure cache hits. */
export const bootstrapBuild = async (hostArg?: string) => {
	const host = bootstrap.toolchainTriple(hostArg ?? std.triple.host());
	const env = std.env.arg(
		tg.build(bootstrap.sdk, host),
		tg.build(bootstrap.make.build, { host }),
		{ utils: false },
	);
	return tg
		.build(build, {
			host,
			env,
			bootstrap: true,
			usePrerequisites: false,
		})
		.named("bootstrap coreutils");
};

/** Obtain just the `env` binary. */
export const gnuEnv = async () => {
	const coreutils = await bootstrapBuild();
	return tg.File.expect(await coreutils.get("bin/env"));
};

/** Release helper - builds gnuEnv with a referent to this file for cache hits. */
export const buildGnuEnv = async () => {
	return tg.build(gnuEnv).named("gnu env");
};

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);
	const sdk = await bootstrap.sdk(host);

	const coreutils = await build({ host, bootstrap: true, env: sdk });

	let expected;
	let script;
	if (os === "linux") {
		script = tg`
			env
			log() {
				echo "$1" | tee -a "$TANGRAM_OUTPUT"
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
				echo "$1" | tee -a "$TANGRAM_OUTPUT"
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
			? libiconv({ host, bootstrap: true, env: sdk })
			: attr({ host, bootstrap: true, env: sdk });
	const output = await std.build`${script}`
		.bootstrap(true)
		.env(
			std.env.arg({ SHELL: "/bin/sh" }, platformSupportLib, coreutils, {
				utils: false,
			}),
		)
		.then(tg.File.expect);

	const contents = (await output.text).trim();
	tg.assert(contents === expected);
	return coreutils;
};
