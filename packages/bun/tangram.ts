import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.42",
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
		"sha256:006648456d2a8d50aa6213d9af65a25042ce01f84060396e5eaa3c98f784dd17",
	["x86_64-linux"]:
		"sha256:368206c3038d8faabc63e3059eeea64c2af9c50ed0dfbfb86f64984ba69db1af",
	["aarch64-darwin"]:
		"sha256:64a70fe290bd6391a09d555d4e4e1a8df56543e526bb1381ab344a385348572c",
	["x86_64-darwin"]:
		"sha256:3f5630e0641d0824eb334cfe89d17cf69b1b6019b68d118afba7b62045794f58",
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
