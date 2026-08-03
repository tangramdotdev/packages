import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.kernel.org",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.19.14",
	tag: "linux/6.19.14",
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:cde8bf6739be4a0777fedbbba5330b8188c55680c45a922a4dfa289cbec6f185";
	const extension = ".tar.xz";
	const majorVersion = version.split(".")[0];
	const base = `https://cdn.kernel.org/pub/linux/kernel/v${majorVersion}.x`;
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.args.BasePackageArg & {
	phases?: std.phases.Arg;
};

export async function kernelHeaders(arg?: tg.Unresolved<Arg>) {
	const {
		build: build_,
		env: env_,
		host: host_,
		phases: phasesArg = {},
		sdk: sdkArg = {},
		source: source_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const buildTriple = build_ ?? host;

	const system = std.triple.archAndOs(buildTriple);

	const sourceDir = source_ ?? source();

	tg.assert(
		std.triple.os(system) === "linux",
		"the Linux kernel headers can only be built on Linux",
	);

	// NOTE - the kernel build wants the string x86_64 on x86_64 but arm64 on aarch64.
	const tripleArch = std.triple.arch(host);
	let karch = tripleArch;
	if (karch === "aarch64") {
		karch = "arm64";
	} else if (karch.includes("arm")) {
		karch = "arm";
	}

	const build = {
		body: tg`make -C ${sourceDir} O="\$PWD" -j"\$(nproc)" ARCH=${karch} headers`,
		post: "find usr/include -type f ! -name '*.h' -delete",
	};
	const install = {
		pre: tg`mkdir -p ${tg.output}`,
		body: tg`cp -r usr/include/. ${tg.output} && mkdir -p ${tg.output}/config && echo ${metadata.version}-default > ${tg.output}/config/kernel.release`,
	};
	const order = ["build", "install"];

	const envs: tg.Unresolved<Array<std.env.Arg>> = [];
	// Add the toolchain, unless the caller asked for none and supplied its own.
	if (sdkArg !== "none") {
		envs.push(await tg.build(std.sdk, ...(sdkArg !== null ? [sdkArg] : [])));
	}

	const env =
		sdkArg === "none"
			? std.env.compose(...envs, env_ ?? null)
			: std.env.arg(...envs, env_ ?? null);

	const result = tg.Directory.expect(
		await std.phases.run(
			{
				env,
				phases: { build, install },
				order,
				host: system,
			},
			{ phases: phasesArg },
		),
	);

	return result;
}

export default kernelHeaders;

export async function test() {
	const host = std.triple.host();
	if (std.triple.os(host) !== "linux") {
		return;
	}

	// test host
	return await testKernelHeaders(host);
}

export async function testKernelHeaders(host: string, target?: string) {
	const target_ = target ?? host;
	const headers = await kernelHeaders({
		build: host,
		host: target_,
	});
	const configFile = tg.File.expect(await headers.get("config/kernel.release"));
	const configFileContents = (await configFile.text).trim();
	tg.assert(configFileContents === `${metadata.version}-default`);
	const kernelH = tg.File.expect(await headers.get("linux/kernel.h"));
	const kernelHContents = await kernelH.text;
	tg.assert(kernelHContents.includes("#ifndef _LINUX_KERNEL_H"));
	return headers;
}
