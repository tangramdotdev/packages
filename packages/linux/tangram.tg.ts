import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.kernel.org",
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.9.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:01b414ba98fd189ecd544435caf3860ae2a790e3ec48f5aa70fdf42dc4c5c04a";
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

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	phases?: tg.MaybeNestedArray<std.phases.Arg>;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
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
		typeof sdk_ === "boolean"
			? await std.sdk({ host: buildTriple, target: host })
			: std.sdk(sdk_);

	let sourceDir = source_ ?? source();

	tg.assert(
		std.triple.os(system) === "linux",
		"The Linux kernel headers can only be built on Linux.",
	);

	// NOTE - the kernel build wants the string x86_64 on x86_64 but arm64 on aarch64.
	let tripleArch = std.triple.arch(host);
	let karch = tripleArch;
	if (karch === "aarch64") {
		karch = "arm64";
	} else if (karch.includes("arm")) {
		karch = "arm";
	}

	let env = [sdk, env_];

	let prepare = tg`cp -r ${sourceDir}/* . && chmod -R +w . && make mrproper`;
	let build = {
		body: `make -j"\$(nproc)" ARCH=${karch} headers`,
		post: "find usr/include -type f ! -name '*.h' -delete",
	};
	let install = {
		pre: "mkdir -p $OUTPUT",
		body: `cp -r usr/include/. $OUTPUT && mkdir -p $OUTPUT/config && echo ${metadata.version}-default > $OUTPUT/config/kernel.release`,
	};
	let order = ["prepare", "build", "install"];

	let result = tg.Directory.expect(
		await std.phases.build(
			{
				env,
				phases: { prepare, build, install },
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
	let host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		return;
	}

	// test host
	return await testKernelHeaders(host);
});

export let testKernelHeaders = async (host: string, target?: string) => {
	let target_ = target ?? host;
	let headers = await kernelHeaders({
		build: host,
		host: target_,
	});
	let configFile = tg.File.expect(await headers.get("config/kernel.release"));
	let configFileContents = (await configFile.text()).trim();
	tg.assert(configFileContents === `${metadata.version}-default`);
	let kernelH = tg.File.expect(await headers.get("linux/kernel.h"));
	let kernelHContents = await kernelH.text();
	tg.assert(kernelHContents.includes("#ifndef _LINUX_KERNEL_H"));
	return headers;
};
