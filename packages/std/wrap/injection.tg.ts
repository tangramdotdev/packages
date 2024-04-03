import * as bootstrap from "../bootstrap.tg.ts";
import * as gcc from "../sdk/gcc.tg.ts";
import * as std from "../tangram.tg.ts";

type Arg = {
	build?: string;
	buildToolchain: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export let injection = tg.target(async (arg: Arg) => {
	let host = arg.host ?? (await std.triple.host());
	let build = arg.build ?? host;
	let os = std.triple.os(host);

	// Get the source.
	let sourceDir = arg?.source
		? arg.source
		: tg.Directory.expect(await tg.include("injection/"));
	let source = tg.File.expect(await sourceDir.get(`${os}/lib.c`));

	// Get the build toolchain.
	let buildToolchain = arg.buildToolchain;

	// Get any additional env.
	let env = arg.env;

	// Select the correct toolchain and options for the given triple.
	let additionalArgs: Array<string | tg.Template> = [];
	if (os === "linux") {
		additionalArgs = ["-Wl,--no-as-needed", "-s"];
		let injection = dylib({
			build,
			buildToolchain,
			env,
			host,
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
	buildToolchain: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source: tg.File;
};

export let macOsInjection = tg.target(async (arg: MacOsInjectionArg) => {
	let host = arg.host ?? (await std.triple.host());
	let os = std.triple.os(host);
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
		env,
	});

	// Compile amd64 dylib.
	let amd64Args = additionalArgs.concat(["--target=x86_64-apple-darwin"]);
	let amd64injection = dylib({
		...arg,
		source,
		additionalArgs: amd64Args,
		env,
	});

	// Combine into universal dylib.
	let system = std.triple.archAndOs(host);
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
	build?: string;
	buildToolchain: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source: tg.File;
};

export let dylib = async (arg: DylibArg): Promise<tg.File> => {
	let host = arg.host ?? (await std.triple.host());
	let build = arg.build ?? host;
	let useTriplePrefix = build !== host && !(std.triple.os(build) === "darwin");

	let additionalArgs = arg.additionalArgs ?? [];
	if (std.triple.os(host) === "linux") {
		additionalArgs.push("-fstack-clash-protection");
	}

	let prefix = useTriplePrefix ? `${host}-` : "";
	let executable = `${prefix}cc`;

	let system = std.triple.archAndOs(host);
	let env = std.env.object(arg.buildToolchain, arg.env);
	let output = tg.File.expect(
		await tg.build(
			tg`${executable}                               \
				-xc ${arg.source}                            \
				-o $OUTPUT                                   \
				-shared                                      \
				-fPIC                                        \
				-ldl                                         \
				-Os                                          \
				-mtune=generic                               \
				-pipe                                        \
				-Wp,-U_FORTIFY_SOURCE,-D_FORTIFY_SOURCE=3    \
				-fasynchronous-unwind-tables                 \
				-fno-omit-frame-pointer                      \
				-mno-omit-leaf-frame-pointer                 \
				-fstack-protector-strong                     \
				${tg.Template.join(" ", ...additionalArgs)}`,
			{
				host: system,
				env,
			},
		),
	);
	return output;
};

export let test = tg.target(async () => {
	let detectedHost = await std.triple.host();
	let hostArch = std.triple.arch(detectedHost);
	tg.assert(hostArch);
	let buildToolchain = bootstrap.sdk.env();
	let nativeInjection = await injection({
		host: detectedHost,
		buildToolchain,
	});

	// Assert the native injection dylib was built for the build machine.
	let os = std.triple.os(std.triple.archAndOs(detectedHost));
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
	return nativeInjection;
});

export let testCross = tg.target(async () => {
	let detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) === "darwin") {
		console.log("Skipping cross test on darwin");
		return true;
	}

	let hostArch = std.triple.arch(detectedHost);
	let targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = `${targetArch}-unknown-linux-gnu`;
	let buildToolchain = gcc.toolchain({ host: detectedHost, target });

	let nativeInjection = await injection({
		build: detectedHost,
		buildToolchain,
		host: target,
	});

	// Assert theinjection dylib was built for the target machine.
	let os = std.triple.os(std.triple.archAndOs(detectedHost));
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
