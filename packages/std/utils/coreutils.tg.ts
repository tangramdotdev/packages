import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import attr from "./attr.tg.ts";
import { macOsXattrCmds } from "./file_cmds.tg.ts";
import libiconv from "./libiconv.tg.ts";
import alwaysPreserveXattrsPatch from "./coreutils-always-preserve-xattrs.patch" with { type: "file" };

export const metadata = {
	name: "coreutils",
	version: "9.11",
	tag: "coreutils/9.11",
};

export async function source(os: string) {
	const { name, version } = metadata;
	const checksum =
		"sha256:394024eda0a5955217ceda9cd1201e65dc8fa3aa29c2951135a49521d57c3cc3";
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
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
	staticBuild?: boolean;
	usePrerequisites?: boolean;
};

export async function build(...args: tg.Args<Arg>) {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		staticBuild = false,
		usePrerequisites = true,
	} = await tg.Args.apply<Arg, tg.ValueOrMaybeMutationMap<Arg>, Arg>({
		args,
		map: async (a) => a,
		reduce: {},
	});
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;
	const os = std.triple.os(host);

	const dependencies: tg.Args<std.env.Arg> = [];

	if (usePrerequisites) {
		dependencies.push(prerequisites(build));
	}

	let attrArtifact;
	if (os === "linux") {
		attrArtifact = attr({
			build,
			...std.args.optional("env", env_),
			host,
			...std.args.optional("sdk", sdk),
			staticBuild,
			usePrerequisites,
		});
		dependencies.push(attrArtifact);
	} else if (os === "darwin") {
		dependencies.push(
			libiconv({
				build,
				...std.args.optional("env", env_),
				host,
				...std.args.optional("sdk", sdk),
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
	if (env_ !== undefined && env_ !== null) {
		env.push(env_);
	}
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
		env: std.env.compose(...env),
		phases,
		processName: metadata.name,
		...(staticBuild ? { opt: "s" as const } : {}),
		...std.args.optional("sdk", sdk),
		source: source_ ?? source(os),
	});

	// On macOS, replace `cp` and `install` with Apple versions in the output.
	if (os === "darwin") {
		output = await tg.directory(
			output,
			{ "bin/cp": null, "bin/install": null },
			...(appleXattrCmds !== undefined ? [appleXattrCmds] : []),
		);
	}

	return output;
}

export default build;

/** Build bootstrap coreutils with consistent, normalized args. This is the shared entry point used by both gnuEnv() and prerequisites() to ensure cache hits. */
export async function bootstrapBuild(hostArg?: string) {
	const host = bootstrap.toolchainTriple(hostArg ?? std.triple.host());
	const env = std.env.compose(
		bootstrap.sdk(host),
		tg.build(bootstrap.make.build, { host }),
	);
	return tg
		.build(build, {
			host,
			env,
			sdk: "none",
			usePrerequisites: false,
		})
		.named("bootstrap coreutils");
}

/** Obtain just the `env` binary. */
export async function gnuEnv() {
	const coreutils = await bootstrapBuild();
	return tg.File.expect(await coreutils.get("bin/env"));
}

/** Release helper - builds gnuEnv with a referent to this file for cache hits. */
export async function buildGnuEnv() {
	return tg.build(gnuEnv).named("gnu env");
}

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);
	const sdk = await bootstrap.sdk(host);

	const coreutils = await build({ host, sdk: "none", env: sdk });

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
			? libiconv({ host, sdk: "none", env: sdk })
			: attr({ host, sdk: "none", env: sdk });
	const output = await std
		.build(std.shBootstrap`${script}`)
		.env({ SHELL: "/bin/sh" }, platformSupportLib, coreutils)
		.then(tg.File.expect);

	const contents = (await output.text).trim();
	tg.assert(contents === expected);
	return coreutils;
}
