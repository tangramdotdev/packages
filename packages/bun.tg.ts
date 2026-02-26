import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.3.10",
	tag: "bun/1.3.10",
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
		"sha256:fa5ecb25cafa8e8f5c87a0f833719d46dd0af0a86c7837d806531212d55636d3",
	["x86_64-linux"]:
		"sha256:f57bc0187e39623de716ba3a389fda5486b2d7be7131a980ba54dc7b733d2e08",
	["aarch64-darwin"]:
		"sha256:82034e87c9d9b4398ea619aee2eed5d2a68c8157e9a6ae2d1052d84d533ccd8d",
	["x86_64-darwin"]:
		"sha256:c1d90bf6140f20e572c473065dc6b37a4b036349b5e9e4133779cc642ad94323",
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
};
