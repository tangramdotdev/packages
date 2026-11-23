import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: {
		exports: ["default", "self"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://www.cloudhypervisor.org",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "Apache-2.0 AND BSD-3-Clause",
	name: "cloud-hypervisor",
	repository: "https://github.com/cloud-hypervisor/cloud-hypervisor",
	version: "54.1",
	tag: "cloud-hypervisor/54.1",
	provides: {
		binaries: ["cloud-hypervisor"],
	},
};

export type Arg = {
	host?: string;
};

/** Download the statically linked release executable. */
export async function self(...args: tg.Args<Arg>) {
	const { host: host_ } = await std.packages.applyArgs<Arg>(...args);
	const { name, version } = metadata;
	const host = host_ ?? std.triple.host();
	std.assert.supportedHost(host, metadata);
	const asset =
		std.triple.arch(host) === "aarch64"
			? `${name}-static-aarch64`
			: `${name}-static`;
	const checksum = binaryChecksums[std.triple.archAndOs(host)];
	tg.assert(checksum, `unsupported host ${host}`);
	const url = `https://github.com/${name}/${name}/releases/download/v${version}/${asset}`;
	const executable = await std
		.download({ url, checksum })
		.then(tg.Blob.expect)
		.then((blob) => tg.file(blob, { executable: true }));
	return tg.directory({
		[`bin/${name}`]: executable,
	});
}

export default self;

const binaryChecksums: { [key: string]: tg.Checksum } = {
	["aarch64-linux"]:
		"sha256:96ef17679a4a75be8eefa1956dd645a57f7974ec50565090ea9298f9bbb761ad",
	["x86_64-linux"]:
		"sha256:f9ffb9646783233d1f0fb09e77db1fca66499d1041e63bc011b90683c0d49933",
};

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
}
