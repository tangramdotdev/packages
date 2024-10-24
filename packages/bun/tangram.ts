import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.33",
};

export type Arg = {
	host?: string;
};

/** Download a pre-compiled binary and wrap it. */
export const toolchain = tg.target(async (...args: std.Args<Arg>) => {
	const { host: host_ } = await std.args.apply<Arg>(...args);
	const { name, version } = metadata;
	const tag = `${name}-v${version}`;
	const host = host_ ?? (await std.triple.host());
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
	const dload = await std.download({ url, checksum }).then(tg.Directory.expect);
	const bun = await dload.get(`${file}/bun`).then(tg.File.expect);
	return tg.directory({
		"bin/bun": std.wrap(bun),
		"bin/bunx": tg.symlink("bun"),
	});
});

export default toolchain;

// Taken from https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt.asc
const binaryChecksums: { [key: string]: tg.Checksum } = {
	["aarch64-linux"]:
		"sha256:ccd3a11a12d7eb2ba23a31dba628e473193c62590c0f334253058a4c8c1cdd79",
	["x86_64-linux"]:
		"sha256:a00205a7d5a749c471f95257c249e750c0504fb4bd9ee8320fee39a89bbaa858",
	["aarch64-darwin"]:
		"sha256:656dbe3f56d658d1b430209eaad73338e639d93c90fd66640b91316a07f1b013",
	["x86_64-darwin"]:
		"sha256:97604230d5c4f34fc8ca9477c198d44cc568c1ce70795a8e8ce2c8f56c5c2f8d",
};

export const test = tg.target(async () => {
	const bun = toolchain();
	const version = await $`bun --version | tee $OUTPUT`
		.env(bun)
		.then(tg.File.expect)
		.then((f) => f.text())
		.then((t) => t.trim());
	tg.assert(
		version === metadata.version,
		`expected ${metadata.version}, got ${version}`,
	);
	return bun;
});
