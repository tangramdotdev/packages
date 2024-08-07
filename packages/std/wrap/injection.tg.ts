import * as bootstrap from "../bootstrap.tg.ts";
import * as gcc from "../sdk/gcc.tg.ts";
import * as std from "../tangram.tg.ts";
import injectionSource from "./injection" with { type: "directory" };

type Arg = {
	build?: string | undefined;
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
	let sourceDir = arg?.source ? arg.source : injectionSource;
	let source = await sourceDir.get(`${os}/lib.c`).then(tg.File.expect);

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
	let env = await std.env.arg(
		{
			SDKROOT: await bootstrap.macOsSdk(),
		},
		arg.env,
	);

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
		await (
			await tg.target(
				tg`lipo -create ${arm64injection} ${amd64injection} -output $OUTPUT`,
				{ host: system, env: std.env.arg(arg.buildToolchain, env) },
			)
		).output(),
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
	let useTriplePrefix = build !== host;

	let args: Array<tg.Template.Arg> = [
		"-shared",
		"-fPIC",
		"-ldl",
		"-O3",
		"-pipe",
		"-mtune=generic",
		"-Wp,-U_FORTIFY_SOURCE,-D_FORTIFY_SOURCE=3",
		"-fasynchronous-unwind-tables",
		"-fno-omit-frame-pointer",
		"-mno-omit-leaf-frame-pointer",
	];
	if (!(std.triple.os(build) === "darwin" && std.triple.os(host) === "linux")) {
		args.push("-fstack-protector-strong");
	}

	if (arg.additionalArgs) {
		args = [...args, ...arg.additionalArgs];
	}
	if (std.triple.os(host) === "linux") {
		args.push("-fstack-clash-protection");
		if (await std.env.tryWhich({ env: arg.buildToolchain, name: "clang" })) {
			args.push("-fuse-ld=lld");
		}
	}

	let prefix = useTriplePrefix ? `${host}-` : "";
	let executable = `${prefix}cc`;

	let system = std.triple.archAndOs(build);
	let env = std.env.arg(
		arg.buildToolchain,
		{
			// Ensure the linker proxy is always skipped, whether or not the toolchain is proxied.
			TANGRAM_LINKER_PASSTHROUGH: true,
		},
		arg.env,
	);
	let output = tg.File.expect(
		await (
			await tg.target(
				tg`${executable} -xc ${arg.source} -o $OUTPUT \
				${tg.Template.join(" ", ...args)}`,
				{
					host: system,
					env,
				},
			)
		).output(),
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
