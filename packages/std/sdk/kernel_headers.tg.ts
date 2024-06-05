import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	homepage: "https://www.kernel.org",
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.9.3",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:c321c46401368774fc236f57095b205a5da57415f9a6008018902f9fd5eddfae";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://cdn.kernel.org/pub/linux/kernel/v6.x/${packageArchive}`;
	let source = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(source);
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	phases?: tg.MaybeNestedArray<std.phases.Arg>;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let kernelHeaders = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		phases: phasesArg = [],
		sdk: sdk_,
		source: source_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let buildTriple = build_ ?? host;

	let system = std.triple.archAndOs(buildTriple);

	let sdk =
		typeof sdk_ === "boolean" ? await bootstrap.sdk.arg(buildTriple) : sdk_;

	let sourceDir = source_ ?? source();

	tg.assert(
		std.triple.os(system) === "linux",
		"the Linux kernel headers can only be built on Linux",
	);

	// NOTE - the kernel build wants the string x86_64 on x86_64 but arm64 on aarch64.
	let tripleArch = std.triple.arch(host);
	let karch = tripleArch;
	if (karch === "aarch64") {
		karch = "arm64";
	} else if (karch.includes("arm")) {
		karch = "arm";
	}

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	env.push(std.sdk(sdk));
	env.push(
		std.utils.env({
			sdk,
			host: buildTriple,
		}),
	);

	let build = {
		body: tg`make -C ${sourceDir} O="\$PWD" -j"\$(nproc)" ARCH=${karch} headers`,
		post: "find usr/include -type f ! -name '*.h' -delete",
	};
	let install = {
		pre: "mkdir -p $OUTPUT",
		body: `cp -r usr/include/. $OUTPUT && mkdir -p $OUTPUT/config && echo ${metadata.version}-default > $OUTPUT/config/kernel.release`,
	};
	let order = ["build", "install"];

	let result = tg.Directory.expect(
		await std.phases.build(
			{
				env: std.env.arg(env),
				phases: { build, install },
				order,
				target: { host: system },
			},
			phasesArg,
		),
	);

	return result;
});

export default kernelHeaders;

export let test = tg.target(async () => {
	let detectedHost = await std.triple.host();
	let host = await bootstrap.toolchainTriple(detectedHost);
	if (std.triple.os(host) !== "linux") {
		return;
	}

	// test host
	await testKernelHeaders(host);

	// test cross
	let hostArch = std.triple.arch(host);
	let targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = std.triple.create(host, { arch: targetArch });
	await testKernelHeaders(host, target);

	return true;
});

export let testKernelHeaders = async (host: string, target?: string) => {
	let target_ = target ?? host;
	let sdk = await bootstrap.sdk(host);
	let headers = await kernelHeaders({
		build: host,
		env: sdk,
		host: target_,
	});
	let configFile = tg.File.expect(await headers.get("config/kernel.release"));
	let configFileContents = (await configFile.text()).trim();
	tg.assert(configFileContents === `${metadata.version}-default`);
	let kernelH = tg.File.expect(await headers.get("linux/kernel.h"));
	let kernelHContents = await kernelH.text();
	tg.assert(kernelHContents.includes("#ifndef _LINUX_KERNEL_H"));
};
