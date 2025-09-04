import * as bootstrap from "../bootstrap.tg.ts";
import * as gnu from "../sdk/gnu.tg.ts";
import * as llvm from "../sdk/llvm.tg.ts";
import * as std from "../tangram.ts";
import * as ogWorkspace from "./workspace.tg.ts";
import packages from "../packages" with { type: "directory" };

type WorkspaceArg = {
	build?: string;
	host?: string;
	release?: boolean;
	source?: tg.Directory;
	verbose?: boolean;
};

type BuildArg = {
	host?: string;
	release?: boolean;
	source: tg.Directory;
	target?: string;
	verbose?: boolean;
};

type WrapArg = {
	workspace?: WorkspaceArg;
	executable: tg.File;
};

export const embedWrapper = async (arg: WrapArg) => {
	// Build the wrap workspace.
	const workspace_ = workspace(arg.workspace ?? {});
	const convertManifest = ogWorkspace.convertManifest({});
	const unwrapped = std.wrap.unwrap(arg.executable);
	const manifest = tg.file(std.wrap.Manifest.read(arg.executable).then(JSON.stringify));
	const env: Array<tg.Unresolved<std.env.Arg>> = [
		{ utils: false }
	];

	let build = {
		command: tg`
			${convertManifest} -o bin < ${manifest} > manifest.bin
			${workspace_}/wrap ${unwrapped} manifest.bin ${workspace_}/stub.bin
		`
	};
	return tg.build(std.phases.run, {
		bootstrap: true,
		env: std.env.arg(...env),
		phases: { build }
	});
};

export const workspace = async (arg: WorkspaceArg) => {
	const {
		build: build_,
		// buildToolchain,
		host: host_,
		release = true,
		source: source_,
		verbose = false,
	} = await tg.resolve(arg);
	const host = host_ ?? (await std.triple.host());
	const buildTriple = build_ ?? host;

	// Get the source.
	const source: tg.Directory = source_
		? source_
		: packages;
	return build({ 
		// buildToolchain,
		host,
		verbose,
		target: buildTriple,
		source,
	})
	.then(tg.Directory.expect);
};

export const bootstrapToolchain = async (host?: string) => {
	let host_ = host ?? await std.triple.host();
	return bootstrap.sdk.env(host_);
}

export const build = async (unresolved: tg.Unresolved<BuildArg>) => {
	const arg = await tg.resolve(unresolved);
	const release = arg.release ?? true;
	const source = arg.source;
	let host_ = arg.host ?? (await std.triple.host());
	const host = standardizeTriple(host_);
	let target_ = arg.target ?? host;
	const target = standardizeTriple(target_);
	const system = std.triple.archAndOs(host);
	const hostOs = std.triple.os(system);
	let verbose = arg.verbose;

	const isCross =
		std.triple.arch(host_) !== std.triple.arch(target_) ||
		std.triple.os(host_) !== std.triple.os(target_);
	let prefix = ``;
	let suffix = tg``;
	if (hostOs === "linux" && isCross) {
		prefix = `${target}-`;
	}

	// Get the appropriate toolchain directory.
	// You need a build toolchian AND a host toolchain. These may be the same.
	let buildToolchain = undefined;
	let hostToolchain = undefined;
	if (hostOs === "linux") {
		if (!isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			host_ = await bootstrap.toolchainTriple(host_);
			target_ = host_;
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
			hostToolchain = await tg.build(gnu.toolchain, { host: host_, target });
		}
	} else {
		if (isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			hostToolchain = await tg
				.build(llvm.toolchain, { host, target })
				.then(tg.Directory.expect);
			const { directory: targetDirectory } = await std.sdk.toolchainComponents({
				env: await std.env.arg(hostToolchain, { utils: false }),
				host: host_,
			});
			suffix = tg.Template
				.raw` -target ${target} --sysroot ${targetDirectory}/${target}/sysroot`;
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
		}
	}
	const env: Array<tg.Unresolved<std.env.Arg>> = [
		{ utils: false },
		buildToolchain,
		hostToolchain,
		{
			[`AR_${tripleToEnvVar(target)}`]: `${prefix}ar`,
			[`CC_${tripleToEnvVar(target)}`]: tg`${prefix}cc${suffix}`,
		}
	];

	// Compile the stub binary.
	let arch  = "x86_64"; // todo: aarch64
	let releaseArgs = release ? "-Os" : "";
	let verboseArgs = verbose ? "-v" : "";
	let buildPhase = {
		command: tg`
			# Create output directory.
			mkdir $OUTPUT

			# Compile the stub.
			$CC_${tripleToEnvVar(target)}			\
				${source}/stub/src/stub.c			\
				${source}/stub/src/${arch}/start.s	\
				-I${source}/stub/include			\
				-Wl,-T${source}/stub/link.ld		\
				-ffreestanding						\
				-fno-stack-protector				\
				-fno-asynchronous-unwind-tables		\
				-fPIC								\
				-mcmodel=small						\
				-nostdlib							\
				-Wl,--oformat=binary				\
				-DDEBUG=1							\
				-o $OUTPUT/stub.bin ${releaseArgs} ${verboseArgs}
			
			# Compile the wrap binary.
			$CC_${tripleToEnvVar(host)}		\
				${source}/stub/src/wrap.c	\
				-I${source}/stub/include	\
				-static						\
				-o $OUTPUT/wrap ${releaseArgs} ${verboseArgs}
		`,
	};
	return await tg.build(std.phases.run, {
		bootstrap: true,
		env: std.env.arg(...env),
		phases: { prepare: undefined, build: buildPhase, install: undefined },
		command: {
			host: system
		},
		network: false,
	});
};

/* Ensure the passed triples are what we expect, musl on linux and standard for macOS. */
const standardizeTriple = (triple: string): string => {
	const components = std.triple.components(triple);
	const os = components.os;

	if (os === "darwin") {
		return std.triple.create({
			...components,
			vendor: "apple",
		});
	} else if (os === "linux") {
		return std.triple.create({
			...components,
			vendor: "unknown",
			environment: "musl",
		});
	} else {
		return tg.unreachable();
	}
};

const tripleToEnvVar = (triple: string, upcase?: boolean) => {
	const allCaps = upcase ?? false;
	let result = triple.replace(/-/g, "_");
	if (allCaps) {
		result = result.toUpperCase();
	}
	return result;
};

export const test = async () => {
	// Detect the host triple.
	const host = await std.triple.host();

	// Determine the target triple with differing architecture from the host.
	const hostArch = std.triple.arch(host);
	tg.assert(hostArch);

	// const buildToolchain = await bootstrap.sdk.env(host);
	return workspace({ host })
};
