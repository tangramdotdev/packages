import * as bootstrap from "../bootstrap.tg.ts";
import * as gcc from "../sdk/gcc.tg.ts";
import * as std from "../tangram.tg.ts";

export let injection = tg.target(async (arg?: std.sdk.BuildEnvArg) => {
	let host = await std.Triple.host(arg);
	let build = arg?.build ? std.triple(arg.build) : host;
	let isBootstrap =
		arg?.bootstrapMode ||
		std.flatten([arg?.sdk]).some((sdk) => sdk?.bootstrapMode);
	let os = host.os;

	// Get the source.
	let sourceDir = tg.Directory.expect(await tg.include("injection/"));
	let source = tg.File.expect(await sourceDir.get(`${os}/lib.c`));

	// Prepare sdk, making sure not to use any proxying.
	let buildToolchain = await tg.directory();
	if (isBootstrap) {
		let { directory } = await std.sdk.toolchainComponents({
			env: await bootstrap.sdk.env({ host }),
		});
		buildToolchain = directory;
	} else {
		buildToolchain = await gcc.toolchain(std.Triple.rotate({ build, host }));
	}

	let env = arg?.env;

	// Select the correct toolchain and options for the given triple.
	let additionalArgs: Array<string | tg.Template> = [];
	if (os === "linux") {
		additionalArgs = ["-Wl,--no-as-needed", "-s"];
		let injection = dylib({
			build,
			buildToolchain,
			env,
			host,
			isBootstrap,
			source,
			additionalArgs,
		});
		return injection;
	} else if (os === "darwin") {
		let injection = macOsInjection({
			buildToolchain,
			env,
			host,
			source,
		});
		return injection;
	} else {
		return tg.unreachable();
	}
});

export default injection;

type MacOsInjectionArg = {
	buildToolchain: tg.Directory;
	env: std.env.Arg;
	host?: std.Triple.Arg;
	source: tg.File;
};

export let macOsInjection = tg.target(async (arg: MacOsInjectionArg) => {
	let host = await std.Triple.host(arg);
	let os = host.os;
	if (os !== "darwin") {
		throw new Error(`Unsupported OS ${os}`);
	}

	let source = arg.source;

	// Define common options.
	let additionalArgs = ["-Wno-nonnull", "-Wno-nullability-completeness"];
	let env = [
		{
			SDKROOT: await bootstrap.macOsSdk(),
		},
		arg.env,
	];

	// Compile arm64 dylib.
	let arm64Args = additionalArgs.concat(["--target=aarch64-apple-darwin"]);
	let arm64injection = dylib({
		...arg,
		source,
		additionalArgs: arm64Args,
		isBootstrap: true,
		env,
	});

	// Compile amd64 dylib.
	let amd64Args = additionalArgs.concat(["--target=x86_64-apple-darwin"]);
	let amd64injection = dylib({
		...arg,
		source,
		additionalArgs: amd64Args,
		isBootstrap: true,
		env,
	});

	// Combine into universal dylib.
	let system = std.Triple.system(host);
	let injection = tg.File.expect(
		await tg.build(
			tg`lipo -create ${arm64injection} ${amd64injection} -output $OUTPUT`,
			{ host: system, env: std.env.object(arg.buildToolchain, env) },
		),
	);
	return injection;
});

type DylibArg = {
	additionalArgs: Array<string | tg.Template>;
	isBootstrap?: boolean;
	build?: std.Triple.Arg;
	buildToolchain: tg.Directory;
	env: std.env.Arg;
	host?: std.Triple.Arg;
	source: tg.File;
};

export let dylib = async (arg: DylibArg): Promise<tg.File> => {
	let host = arg.host ? std.triple(arg.host) : await std.Triple.host();
	let build = arg.build ? std.triple(arg.build) : host;
	let isBootstrap = arg.isBootstrap ?? false;
	let useTriplePrefix =
		!std.Triple.eq(build, host) && !isBootstrap && !(build.os === "darwin");
	let hostString = std.Triple.toString(host);

	let additionalArgs = arg.additionalArgs ?? [];
	if (host.os === "linux") {
		let subpath = useTriplePrefix
			? tg`${arg.buildToolchain}/${hostString}`
			: tg`${arg.buildToolchain}`;
		additionalArgs.push(await tg`--sysroot=${subpath}`);
	}

	let prefix = useTriplePrefix ? `${hostString}-` : "";
	let executable = `${prefix}cc`;

	let system = std.Triple.system(host);
	let env = std.env.object(arg.buildToolchain, arg.env);
	let output = tg.File.expect(
		await tg.build(
			tg`${executable} -xc ${
				arg.source
			} -o $OUTPUT -shared  -fPIC -ldl -Os ${tg.Template.join(
				" ",
				...additionalArgs,
			)}`,
			{
				host: system,
				env,
			},
		),
	);
	return output;
};

export let test = tg.target(async () => {
	let detectedHost = await std.Triple.host();
	let hostArch = detectedHost.arch;
	let nativeInjection = await injection({
		host: detectedHost,
		bootstrapMode: true,
	});

	// Assert the native injection dylib was built for the build machine.
	let os = tg.System.os(std.Triple.system(detectedHost));
	let nativeMetadata = await std.file.executableMetadata(nativeInjection);
	if (os === "linux") {
		tg.assert(nativeMetadata.format === "elf");
		tg.assert(nativeMetadata.arch === hostArch);
	} else if (os === "darwin") {
		tg.assert(nativeMetadata.format === "mach-o");
		tg.assert(nativeMetadata.arches.includes(hostArch));
	} else {
		return tg.unreachable();
	}
});

export let testCross = tg.target(async () => {
	let detectedHost = await std.Triple.host();
	if (detectedHost.os === "darwin") {
		console.log("Skipping cross test on darwin");
		return true;
	}

	let hostArch = detectedHost.arch;
	let targetArch: std.Triple.Arch =
		hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = std.triple({ ...detectedHost, arch: targetArch });

	let nativeInjection = await injection({
		build: detectedHost,
		host: target,
	});

	// Assert theinjection dylib was built for the target machine.
	let os = tg.System.os(std.Triple.system(detectedHost));
	let nativeMetadata = await std.file.executableMetadata(nativeInjection);
	if (os === "linux") {
		tg.assert(nativeMetadata.format === "elf");
		tg.assert(nativeMetadata.arch === targetArch);
	} else if (os === "darwin") {
		tg.assert(nativeMetadata.format === "mach-o");
		tg.assert(nativeMetadata.arches.includes(targetArch));
	} else {
		return tg.unreachable();
	}
});
