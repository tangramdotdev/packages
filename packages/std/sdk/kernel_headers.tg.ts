import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	homepage: "https://www.kernel.org",
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.8.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:9ac322d85bcf98a04667d929f5c2666b15bd58c6c2d68dd512c72acbced07d04";
	let unpackFormat = ".tar.xz" as const;
	let url = `https://cdn.kernel.org/pub/linux/kernel/v6.x/${name}-${version}${unpackFormat}`;
	let source = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return std.directory.unwrap(source);
});

type Arg = std.sdk.BuildEnvArg & {
	phases?: tg.MaybeNestedArray<std.phases.Arg>;
	source?: tg.Directory;
};

export let kernelHeaders = tg.target(async (arg?: Arg) => {
	let {
		bootstrapMode,
		build: build_,
		env: env_,
		host: host_,
		phases: phasesArg = [],
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let buildTriple = build_ ?? host;

	let system = std.triple.archAndOs(buildTriple);

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

	let env: tg.Unresolved<Array<std.env.Arg>> = [];
	if (bootstrapMode) {
		env = env.concat([
			std.utils.env({ ...rest, bootstrapMode, env: env_, host: buildTriple }),
			bootstrap.make.build(buildTriple),
		]);
	} else {
		env.push(std.sdk({ host: buildTriple }, arg?.sdk));
	}
	env.push(env_);

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
	let detectedHost = await std.triple.host();
	let host = bootstrap.toolchainTriple(detectedHost);
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
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let headers = await kernelHeaders({
		bootstrapMode,
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
