import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.14",
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
		"sha256:90193338b1bc3b83af8f0287883898144bc07b742d0c90dda062af333498e700",
	["x86_64-linux"]:
		"sha256:2c27c1c59311f8323d1c3be4dd90891853ed7affb853d01cc58fea0d86e93ae0",
	["aarch64-darwin"]:
		"sha256:24a5009945bf2e1efc4546413a4d5c5cba4cae1c6c9175ba04ef967186a7585b",
	["x86_64-darwin"]:
		"sha256:cc39e0274cd344242ab9f3661918f0ce2fbbecae13a4fe82ff6955a80e32108d",
};
