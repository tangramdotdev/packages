import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.kernel.org",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.12.1",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0193b1d86dd372ec891bae799f6da20deef16fc199f30080a4ea9de8cef0c619";
	const extension = ".tar.xz";
	const base = `https://cdn.kernel.org/pub/linux/kernel/v6.x`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	phases?: std.phases.Arg;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const kernelHeaders = tg.command(async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		phases: phasesArg = {},
		sdk: sdk_,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	const host = host_ ?? (await std.triple.host());
	std.assert.supportedHost(host, metadata);
	const buildTriple = build_ ?? host;

	const system = std.triple.archAndOs(buildTriple);

	const sdk =
		typeof sdk_ === "boolean"
			? await std.sdk({ host: buildTriple, target: host })
			: std.sdk(sdk_);

	const sourceDir = source_ ?? source();

	tg.assert(
		std.triple.os(system) === "linux",
		"The Linux kernel headers can only be built on Linux.",
	);

	// NOTE - the kernel build wants the string x86_64 on x86_64 but arm64 on aarch64.
	const tripleArch = std.triple.arch(host);
	let karch = tripleArch;
	if (karch === "aarch64") {
		karch = "arm64";
	} else if (karch.includes("arm")) {
		karch = "arm";
	}

	const env = [sdk, env_];

	const prepare = tg`cp -r ${sourceDir}/* . && chmod -R +w . && make mrproper`;
	const build = {
		body: `make -j"\$(nproc)" ARCH=${karch} headers`,
		post: "find usr/include -type f ! -name '*.h' -delete",
	};
	const install = {
		pre: "mkdir -p $OUTPUT",
		body: `cp -r usr/include/. $OUTPUT && mkdir -p $OUTPUT/config && echo ${metadata.version}-default > $OUTPUT/config/kernel.release`,
	};
	const order = ["prepare", "build", "install"];

	const result = tg.Directory.expect(
		await std.phases.build(
			{
				env: std.env.arg(env),
				phases: { prepare, build, install },
				order,
				command: { host: system },
			},
			phasesArg,
		),
	);

	return result;
});

export default kernelHeaders;

export const test = tg.command(async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		return;
	}

	// test host
	return await testKernelHeaders(host);
});

export const testKernelHeaders = async (host: string, target?: string) => {
	const target_ = target ?? host;
	const headers = await kernelHeaders({
		build: host,
		host: target_,
	});
	const configFile = tg.File.expect(await headers.get("config/kernel.release"));
	const configFileContents = (await configFile.text()).trim();
	tg.assert(configFileContents === `${metadata.version}-default`);
	const kernelH = tg.File.expect(await headers.get("linux/kernel.h"));
	const kernelHContents = await kernelH.text();
	tg.assert(kernelHContents.includes("#ifndef _LINUX_KERNEL_H"));
	return headers;
};
