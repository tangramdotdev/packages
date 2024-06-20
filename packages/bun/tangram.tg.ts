import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.15",
};

export type Arg = {
	host?: string;
};

/** Download a pre-compiled binary and wrap it. */
export let toolchain = tg.target(async (...args: std.Args<Arg>) => {
	let { host: host_ } = await std.args.apply<Arg>(...args);
	let { name, version } = metadata;
	let tag = `${name}-v${version}`;
	let host = host_ ?? (await std.triple.host());
	let arch;
	if (std.triple.arch(host) === "aarch64") {
		arch = "aarch64";
	} else if (std.triple.arch(host) === "x86_64") {
		arch = "x64";
	} else {
		throw new Error(`unsupported host ${host}`);
	}
	let file = `bun-${std.triple.os(host)}-${arch}`;
	let checksum = binaryChecksums[std.triple.archAndOs(host)];
	tg.assert(checksum, `unsupported host ${host}`);
	let url = `https://github.com/oven-sh/bun/releases/download/${tag}/${file}.zip`;
	let dload = await std.download({ url, checksum }).then(tg.Directory.expect);
	let bun = await dload.get(`${file}/bun`).then(tg.File.expect);
	return tg.directory({
		"bin/bun": std.wrap(bun),
		"bin/bunx": tg.symlink("bun"),
	});
});

export default toolchain;

// Taken from https://github.com/oven-sh/bun/releases/download/bun-v1.1.14/SHASUMS256.txt.asc
let binaryChecksums: { [key: string]: tg.Checksum } = {
	["aarch64-linux"]:
		"sha256:7a459ca19c46b2ad40b412df973ce1550da554fc10b7ad58f3a3151ed149b144",
	["x86_64-linux"]:
		"sha256:3cb191ed311dcb7b10dd2f6b2967bccfc823ae66fc493c983f36d13da25848f2",
	["aarch64-darwin"]:
		"sha256:4fa577079e2ba5d36617ad255f5dfb3dabbcd3e13fdb569297a2c26bee861eae:",
	["x86_64-darwin"]:
		"sha256:a353568ee593c0841a98b1b5d1453b2dac19f6307c443b8b58929b08210875e5",
};
