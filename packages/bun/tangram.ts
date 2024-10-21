import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.31",
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
		"sha256:66e535e06bc0b5fd67d6c03c6a6b595121a9e62279aa9fd2236c2bc381b07bfe",
	["x86_64-linux"]:
		"sha256:cc78ad1b82adb7e8822a4f46ac2dc2e0c4525a153187cf645bd6d4787cea349b",
	["aarch64-darwin"]:
		"sha256:74e4057e4c4288e16602bd750a349d48a36988b11191b5566b002ecbc0129091",
	["x86_64-darwin"]:
		"sha256:0041317ccc54a7bb256baa425f3ebd6badae8f42ab25ed1adc4f8043760e87bd",
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
