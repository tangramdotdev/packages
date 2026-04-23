import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.3.13",
	tag: "bun/1.3.13",
	provides: {
		binaries: ["bun"],
	},
};

export type Arg = {
	host?: string;
};

/** Download a pre-compiled binary and wrap it. */
export const self = async (...args: std.Args<Arg>) => {
	const { host: host_ } = await std.packages.applyArgs<Arg>(...args);
	const { name, version } = metadata;
	const tag = `${name}-v${version}`;
	const host = host_ ?? std.triple.host();
	let arch;
	if (std.triple.arch(host) === "aarch64") {
		arch = "aarch64";
	} else if (std.triple.arch(host) === "x86_64") {
		arch = "x64";
	} else {
		throw new Error(`unsupported host ${host}`);
	}
	const file = `bun-${std.triple.os(host)}-${arch}`;
	const checksum = binaryChecksums[std.triple.archAndOs(host)];
	tg.assert(checksum, `unsupported host ${host}`);
	const url = `https://github.com/oven-sh/bun/releases/download/${tag}/${file}.zip`;
	const dload = await std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect);
	const bun = await dload
		.get(`${file}/bun`)
		.then(tg.File.expect)
		.then((f) => tg.file(f, { executable: true }));
	return tg.directory({
		"bin/bun": std.wrap(bun),
		"bin/bunx": tg.symlink("bun"),
	});
};

export default self;

// Taken from https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt.asc
const binaryChecksums: { [key: string]: tg.Checksum } = {
	["aarch64-linux"]:
		"sha256:70bae41b3908b0a120e1e58c5c8af30e74afae3b8d11b0d3fdd8e787ddfb4b22",
	["x86_64-linux"]:
		"sha256:79c0771fa8b92c33aae41e15a0e0d307ea99d0e2f00317c71c6c53237a78e25a",
	["aarch64-darwin"]:
		"sha256:5467e3f65dba526b9fea98f0cce04efafc0c63e169733ec27b876a3ad32da190",
	["x86_64-darwin"]:
		"sha256:e5a6c8b64f419925232d111ecb13e25f0abf55e54f792341f987623fd0778009",
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
};
