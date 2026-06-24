import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.3.14",
	tag: "bun/1.3.14",
	provides: {
		binaries: ["bun"],
	},
};

export type Arg = {
	host?: string;
};

/** Download a pre-compiled binary and wrap it. */
export async function self(...args: std.Args<Arg>) {
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
		"sha256:a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b",
	["x86_64-linux"]:
		"sha256:951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f",
	["aarch64-darwin"]:
		"sha256:d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620",
	["x86_64-darwin"]:
		"sha256:4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633",
};

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
}
