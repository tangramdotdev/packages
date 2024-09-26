import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.17",
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
		"sha256:7b2b58e392dc81e23d9bd6a61ddf217c4ecbcfb113ee9d7d877ec18b8c941c13",
	["x86_64-linux"]:
		"sha256:a51820bbf9741e00a4ef7917ed6e37a8a155135dffee93f83fd6d38aac8ad989",
	["aarch64-darwin"]:
		"sha256:6942e0459f5ebdc19484a27ab252c93a0dc813351e35f224245f110cfdd8525a",
	["x86_64-darwin"]:
		"sha256:6c5ff283b0b6b6c74f8e8b42e032884994561145265216b6dad589ca779aac43",
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
