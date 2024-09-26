import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.kernel.org",
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.9.6",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5d4366e2b89998f274abe03557ef3bc78b58e47fc62c102d51e6f49e5ed96b4b";
	const extension = ".tar.xz";
	const base = `https://cdn.kernel.org/pub/linux/kernel/v6.x`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	phases?: tg.MaybeNestedArray<std.phases.Arg>;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export const kernelHeaders = tg.target(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		phases: phasesArg = [],
		sdk: sdk_,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
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
				target: { host: system },
			},
			phasesArg,
		),
	);

	return result;
});

export default kernelHeaders;

export const test = tg.target(async () => {
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
