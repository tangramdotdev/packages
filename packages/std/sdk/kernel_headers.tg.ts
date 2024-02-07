import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	homepage: "https://www.kernel.org",
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.7.4",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:f68d9f5ffc0a24f850699b86c8aea8b8687de7384158d5ed3bede37de098d60c";
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
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let buildTriple = build_ ? std.triple(build_) : host;

	let system = std.Triple.system(buildTriple);

	let sourceDir = source_ ?? source();

	tg.assert(
		tg.System.os(system) === "linux",
		"The Linux kernel headers can only be built on Linux.",
	);

	// NOTE - the kernel build wants the string x86_64 on x86_64 but arm64 on aarch64.
	let tripleArch = host.arch;
	let karch = tripleArch.toString();
	if (karch === "aarch64") {
		karch = "arm64";
	} else if (karch.includes("arm")) {
		karch = "arm";
	}

	let env: tg.Unresolved<Array<std.env.Arg>> = [];
	if (bootstrapMode) {
		env = env.concat([
			std.utils.env({ ...rest, bootstrapMode, env: env_, host: buildTriple }),
			bootstrap.make.build({ host: buildTriple }),
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
	let detectedHost = await std.Triple.host();
	let host = bootstrap.toolchainTriple(detectedHost);
	if (host.os !== "linux") {
		return;
	}

	// test host
	await testKernelHeaders(host);

	// test cross
	let hostArch = host.arch;
	let targetArch: std.Triple.Arch =
		hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = std.triple({ ...host, arch: targetArch });
	await testKernelHeaders(host, target);

	return true;
});

export let testKernelHeaders = async (
	host: std.Triple,
	target?: std.Triple,
) => {
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
