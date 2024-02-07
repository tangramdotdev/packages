import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import attr from "./attr.tg.ts";
import { macOsXattrCmds } from "./file_cmds.tg.ts";
import libiconv from "./libiconv.tg.ts";

export let metadata = {
	name: "coreutils",
	version: "9.4",
};

export let source = tg.target(async (os: tg.System.Os) => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:ea613a4cf44612326e917201bbbcdfbd301de21ffc3b59b6e5c07e040b275e52";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat,
		checksum,
	});

	// Apply xattr patch on Linux.
	if (os === "linux") {
		let patch = tg.File.expect(
			await tg.include("coreutils-always-preserve-xattrs.patch"),
		);
		source = await bootstrap.patch(source, patch);
	}

	return source;
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
	usePrerequisites?: boolean;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		bootstrapMode,
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		usePrerequisites = true,
		...rest
	} = arg ?? {};
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;
	let os = host.os;

	let dependencies: tg.Unresolved<std.env.Arg> = [];

	if (bootstrapMode && usePrerequisites) {
		dependencies.push(prerequisites({ host }));
	}

	let attrArtifact;
	if (os === "linux") {
		attrArtifact = attr({
			...rest,
			bootstrapMode,
			build,
			env: env_,
			host,
			usePrerequisites,
		});
		dependencies.push(attrArtifact);
	} else if (os === "darwin") {
		dependencies.push(
			libiconv({
				...rest,
				bootstrapMode,
				build,
				env: env_,
				host,
				usePrerequisites,
			}),
		);
	}
	let env = [...dependencies, env_];

	let configure = {
		args: [
			`--build=${std.Triple.toString(build)}`,
			`--host=${std.Triple.toString(host)}`,
			"--disable-dependency-tracking",
			"--disable-libcap",
			"--disable-nls",
			"--disable-rpath",
		],
	};

	let output = buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases: { configure },
			source: source_ ?? source(os),
		},
		autotools,
	);

	// On macOS, replace `install` with the Apple Open Source version that correctly handles xattrs.
	if (os === "darwin") {
		output = tg.directory(
			output,
			{ "bin/install": undefined },
			macOsXattrCmds(arg),
		);
	}

	return output;
});

export default build;

/** This test asserts that this installation of coreutils preserves xattrs when using both `cp` and `install` on Linux. */
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	let system = std.Triple.system(host);
	let os = tg.System.os(system);
	let bootstrapMode = true;
	let sdk = std.sdk({ bootstrapMode, host });

	let coreutils = await build({ host, bootstrapMode, env: sdk });

	await std.assert.pkg({
		binaries: ["cp", "mkdir", "mv", "ls", "rm"],
		directory: coreutils,
		metadata,
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
			? libiconv({ bootstrapMode, host, env: sdk })
			: attr({ bootstrapMode, host, env: sdk });
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
