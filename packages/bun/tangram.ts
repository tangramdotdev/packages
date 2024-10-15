import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.30",
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
		"sha256:4f7059e4942849204e11b358eccc831dde958b0df8c8b1efbe85d16eeb1f8d26",
	["x86_64-linux"]:
		"sha256:5060f233eecbed8197686b37b0eb2da8ff52282f57bd1dd8e394f53afdec840e",
	["aarch64-darwin"]:
		"sha256:e14f0f18b6d14a345b3ea369d1e176181fc43363fe720fc2ee9281bf827792cc",
	["x86_64-darwin"]:
		"sha256:5171a787b4b9ef64ffbac4e8790e39e90b448aae56f1f69debc162941b9319b2",
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
