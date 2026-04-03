import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.3.11",
	tag: "bun/1.3.11",
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
		"sha256:d13944da12a53ecc74bf6a720bd1d04c4555c038dfe422365356a7be47691fdf",
	["x86_64-linux"]:
		"sha256:8611ba935af886f05a6f38740a15160326c15e5d5d07adef966130b4493607ed",
	["aarch64-darwin"]:
		"sha256:6f5a3467ed9caec4795bf78cd476507d9f870c7d57b86c945fcb338126772ffc",
	["x86_64-darwin"]:
		"sha256:c4fe2b9247218b0295f24e895aaec8fee62e74452679a9026b67eacbd611a286",
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
};
