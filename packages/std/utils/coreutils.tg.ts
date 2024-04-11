import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, muslRuntimeEnv, prerequisites } from "../utils.tg.ts";
import attr from "./attr.tg.ts";
import { macOsXattrCmds } from "./file_cmds.tg.ts";
import libiconv from "./libiconv.tg.ts";

export let metadata = {
	name: "coreutils",
	version: "9.5",
};

export let source = tg.target(async (os: string) => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:cd328edeac92f6a665de9f323c93b712af1858bc2e0d88f3f7100469470a1b8a";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat,
		checksum,
	});

	// Apply xattr patch on Linux.
	if (os === "linux") {
		let patches = [];
		patches.push(
			tg.File.expect(
				await tg.include("coreutils-always-preserve-xattrs.patch"),
			),
		);
		source = await bootstrap.patch(source, ...patches);
	}

	return source;
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
	staticBuild?: boolean;
	usePrerequisites?: boolean;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		staticBuild = false,
		usePrerequisites = true,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let dependencies: tg.Unresolved<std.env.Arg> = [];

	if (usePrerequisites) {
		dependencies.push(prerequisites(host));
	}

	let attrArtifact;
	if (os === "linux") {
		attrArtifact = attr({
			...rest,
			build,
			env: env_,
			host,
			staticBuild,
			usePrerequisites,
		});
		dependencies.push(attrArtifact);
	} else if (os === "darwin") {
		dependencies.push(
			libiconv({
				...rest,
				build,
				env: env_,
				host,
				usePrerequisites,
			}),
		);
	}
	let env = [env_, ...dependencies];
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}

	let configure = {
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

	let output = await buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			opt: staticBuild ? "s" : undefined,
			source: source_ ?? source(os),
		},
		autotools,
	);

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
export let gnuEnv = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = bootstrap.sdk(host);
	let make = await bootstrap.make.build(host);
	let muslEnv = muslRuntimeEnv(host);
	let directory = await build({
		host,
		env: [sdk, make, muslEnv],
		staticBuild: true,
		usePrerequisites: false,
	});
	let exe = tg.File.expect(await directory.get("bin/env"));
	return exe;
});

/** This test asserts that this installation of coreutils preserves xattrs when using both `cp` and `install` on Linux. */
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let system = std.triple.archAndOs(host);
	let os = std.triple.os(system);
	let sdkArg = await bootstrap.sdk.arg(host);

	let coreutils = await build({ host, sdk: sdkArg });

	await std.assert.pkg({
		binaries: ["cp", "mkdir", "mv", "ls", "rm"],
		directory: coreutils,
		metadata,
		sdk: sdkArg,
	});

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
	let platformSupportLib =
		os === "darwin"
			? libiconv({ host, sdk: sdkArg })
			: attr({ host, sdk: sdkArg });
	let output = tg.File.expect(
		await tg.build(script, {
			env: std.env.object(platformSupportLib, coreutils),
		}),
	);

	let contents = (await output.text()).trim();
	console.log("actual", contents);
	console.log("expected", expected);
	tg.assert(contents === expected);
	return coreutils;
});
