import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	homepage: "https://www.kernel.org",
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.6.10",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:9ee627e4c109aec7fca3eda5898e81d201af2c7eb2f7d9d7d94c1f0e1205546c";
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
		build: build_,
		host: host_,
		phases: phasesArg = [],
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let buildTriple = build_ ? std.triple(build_) : host;

	let system = std.Triple.system(host);

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
	}

	// The kernel headers always use the musl-based bootstrap toolchain.
	let buildToolchain = await bootstrap.toolchain({ host: buildTriple });
	let buildLibPath = tg`${buildToolchain}/lib`;
	let ccFlags = tg`-Wl,-dynamic-linker,${buildLibPath}/${bootstrap.interpreterName(
		buildTriple,
	)} -Wl,-rpath,${buildLibPath}`;
	let env = [
		bootstrap.sdk.env({ host: buildTriple }),
		bootstrap.make.build({ host: buildTriple }),
		std.utils.env({ ...rest, host: buildTriple, sdk: { bootstrapMode: true } }),
		{
			CC: tg`gcc ${ccFlags}`,
		},
	];

	let prepare = tg`cp -r ${sourceDir}/* . && chmod -R +w . && make mrproper`;
	let build = {
		body: `make -j"\$(nproc)" ARCH=${karch} HOSTCC="\$CC" headers`,
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
				target: { host: std.Triple.system(host) },
			},
			phasesArg,
		),
	);

	return result;
});

export default kernelHeaders;

export let test = tg.target(async () => {
	let host = await std.Triple.host();
	if (host.os !== "linux") {
		return;
	}

	// test host
	await testKernelHeaders(host);

	// test cross
	let hostArch = host.arch;
	let targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = std.triple({ ...host, arch: targetArch });
	await testKernelHeaders(host, target);

	return true;
});

export let testKernelHeaders = async (
	host: std.Triple,
	target?: std.Triple,
) => {
	let target_ = target ?? host;
	let headers = await kernelHeaders({ build: host, host: target_ });
	let configFile = tg.File.expect(await headers.get("config/kernel.release"));
	let configFileContents = (await configFile.text()).trim();
	tg.assert(configFileContents === `${metadata.version}-default`);
	let kernelH = tg.File.expect(await headers.get("linux/kernel.h"));
	let kernelHContents = await kernelH.text();
	tg.assert(kernelHContents.includes("#ifndef _LINUX_KERNEL_H"));
};
