import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

export const metadata = {
	homepage: "https://www.kernel.org",
	license: "GPLv2",
	name: "linux",
	repository: "https://git.kernel.org",
	version: "6.12.48",
	tag: "linux/6.12.48",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5bf9eb676751bf48978e38363c772298b41a75336d5038ed6d37012399471db2";
	const extension = ".tar.xz";
	const majorVersion = version.split(".")[0];
	const base = `https://cdn.kernel.org/pub/linux/kernel/v${majorVersion}.x`;
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	bootstrap?: boolean;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	phases?: std.phases.Arg;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const kernelHeaders = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		phases: phasesArg = {},
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? (await std.triple.host());
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
		pre: "mkdir -p $OUTPUT",
		body: `cp -r usr/include/. $OUTPUT && mkdir -p $OUTPUT/config && echo ${metadata.version}-default > $OUTPUT/config/kernel.release`,
	};
	const order = ["build", "install"];

	const envs: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (!bootstrap_) {
		// Add the toolchain.
		const sdkArg =
			typeof sdk === "boolean"
				? { host: buildTriple, target: buildTriple }
				: sdk;
		envs.push(await tg.build(std.sdk, sdkArg));

		// Add the standard utils, built with the default SDK.
		const utils = await tg.build(std.utils.defaultEnv);
		envs.push(utils);
	}
	const env = std.env.arg(...envs, { utils: false });

	const result = tg.Directory.expect(
		await tg.build(
			std.phases.run,
			{
				bootstrap: bootstrap_,
				env,
				phases: { build, install },
				order,
				command: { host: system },
			},
			phasesArg,
		),
	);

	return result;
};

export default kernelHeaders;

export const test = async () => {
	const detectedHost = await std.triple.host();
	const host = await bootstrap.toolchainTriple(detectedHost);
	if (std.triple.os(host) !== "linux") {
		return;
	}

	// test host
	await testKernelHeaders(host);

	// test cross
	const hostArch = std.triple.arch(host);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = std.triple.create(host, { arch: targetArch });
	await testKernelHeaders(host, target);

	return true;
};

export const testKernelHeaders = async (host: string, target?: string) => {
	const target_ = target ?? host;
	const buildEnv = std.env.arg(
		bootstrap.sdk(host),
		bootstrap.make.default({ host }),
		{ utils: false },
	);
	const headers = await kernelHeaders({
		bootstrap: true,
		build: host,
		env: buildEnv,
		host: target_,
	});
	const configFile = tg.File.expect(await headers.get("config/kernel.release"));
	const configFileContents = (await configFile.text()).trim();
	tg.assert(configFileContents === `${metadata.version}-default`);
	const kernelH = tg.File.expect(await headers.get("linux/kernel.h"));
	const kernelHContents = await kernelH.text();
	tg.assert(kernelHContents.includes("#ifndef _LINUX_KERNEL_H"));
};
