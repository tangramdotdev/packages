import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.4.0",
	tag: "bun/1.4.0",
	provides: {
		binaries: ["bun"],
	},
};

export type Arg = {
	host?: string;
};

/** Download a pre-compiled binary and wrap it. */
export async function self(...args: tg.Args<Arg>) {
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
}

export default self;

// Taken from https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt.asc
const binaryChecksums: { [key: string]: tg.Checksum } = {
	["aarch64-linux"]:
		"sha256:4b1a332ee861983eb93bcfe6f770fff94e3e31b2c388bdaea3c8ed35e58eed0e",
	["x86_64-linux"]:
		"sha256:2d03fb5fb83ac8b567aca0a281b2ce1a1a19d488f56c2968d88c3f25e92fe452",
	["aarch64-darwin"]:
		"sha256:c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381",
	["x86_64-darwin"]:
		"sha256:1d0211b8f1dc991182344687ad15e72ee86f154845a5f7fa477994cd341dd9b0",
};

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
}
