import * as bootstrap from "../bootstrap.tg.ts";
import * as gnu from "../sdk/gnu.tg.ts";
import * as std from "../tangram.ts";
import injectionSource from "./injection" with { type: "directory" };

type Arg = {
	build?: string | undefined;
	buildToolchain: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export const injection = tg.target(async (arg: Arg) => {
	const host = arg.host ?? (await std.triple.host());
	const build = arg.build ?? host;
	const os = std.triple.os(host);

	// Get the source.
	const sourceDir = arg?.source ? arg.source : injectionSource;
	const source = await sourceDir.get(`${os}/lib.c`).then(tg.File.expect);

	// Get the build toolchain.
	const buildToolchain = arg.buildToolchain;

	// Get any additional env.
	const env = arg.env;

	// Select the correct toolchain and options for the given triple.
	let additionalArgs: Array<string | tg.Template> = [];
	if (os === "linux") {
		additionalArgs = ["-Wl,--no-as-needed", "-s"];
		const injection = dylib({
			build,
			buildToolchain,
			env,
			host,
			source,
			additionalArgs,
		});
		return injection;
	} else if (os === "darwin") {
		const injection = macOsInjection({
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

export const macOsInjection = tg.target(async (arg: MacOsInjectionArg) => {
	const host = arg.host ?? (await std.triple.host());
	const os = std.triple.os(host);
	if (os !== "darwin") {
		throw new Error(`Unsupported OS ${os}`);
	}

	const source = arg.source;

	// Define common options.
	const additionalArgs = ["-Wno-nonnull", "-Wno-nullability-completeness"];
	const env = await std.env.arg(
		{
			SDKROOT: await bootstrap.macOsSdk(),
		},
		arg.env,
	);

	// Compile arm64 dylib.
	const arm64Args = additionalArgs.concat(["--target=aarch64-apple-darwin"]);
	const arm64injection = dylib({
		...arg,
		source,
		additionalArgs: arm64Args,
		env,
	});

	// Compile amd64 dylib.
	const amd64Args = additionalArgs.concat(["--target=x86_64-apple-darwin"]);
	const amd64injection = dylib({
		...arg,
		source,
		additionalArgs: amd64Args,
		env,
	});

	// Combine into universal dylib.
	const system = std.triple.archAndOs(host);
	const injection = tg.File.expect(
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

export const dylib = async (arg: DylibArg): Promise<tg.File> => {
	const host = arg.host ?? (await std.triple.host());
	const build = arg.build ?? host;
	const useTriplePrefix = build !== host;

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

	const prefix = useTriplePrefix ? `${host}-` : "";
	const executable = `${prefix}cc`;

	const system = std.triple.archAndOs(build);
	const env = std.env.arg(
		arg.buildToolchain,
		{
			// Ensure the linker proxy is always skipped, whether or not the toolchain is proxied.
			TANGRAM_LINKER_PASSTHROUGH: true,
		},
		arg.env,
	);
	const output = tg.File.expect(
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

export const test = tg.target(async () => {
	const detectedHost = await std.triple.host();
	const hostArch = std.triple.arch(detectedHost);
	tg.assert(hostArch);
	const buildToolchain = bootstrap.sdk.env();
	const nativeInjection = await injection({
		host: detectedHost,
		buildToolchain,
	});

	// Assert the native injection dylib was built for the build machine.
	const os = std.triple.os(std.triple.archAndOs(detectedHost));
	const nativeMetadata = await std.file.executableMetadata(nativeInjection);
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

export const testCross = tg.target(async () => {
	const detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) === "darwin") {
		console.log("Skipping cross test on darwin");
		return true;
	}

	const hostArch = std.triple.arch(detectedHost);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = `${targetArch}-unknown-linux-gnu`;
	const buildToolchain = gnu.toolchain({ host: detectedHost, target });

	const nativeInjection = await injection({
		build: detectedHost,
		buildToolchain,
		host: target,
	});

	// Assert theinjection dylib was built for the target machine.
	const os = std.triple.os(std.triple.archAndOs(detectedHost));
	const nativeMetadata = await std.file.executableMetadata(nativeInjection);
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
