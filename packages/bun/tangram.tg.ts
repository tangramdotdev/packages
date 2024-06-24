import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://bun.sh",
	license: "MIT",
	name: "bun",
	repository: "https://github.com/oven-sh/bun",
	version: "1.1.16",
};

export type Arg = {
	host?: string;
};

/** Download a pre-compiled binary and wrap it. */
export let toolchain = tg.target(async (...args: std.Args<Arg>) => {
	let { host: host_ } = await std.args.apply<Arg>(...args);
	let { name, version } = metadata;
	let tag = `${name}-v${version}`;
	let host = host_ ?? (await std.triple.host());
	let arch;
	if (std.triple.arch(host) === "aarch64") {
		arch = "aarch64";
	} else if (std.triple.arch(host) === "x86_64") {
		arch = "x64";
	} else {
		throw new Error(`unsupported host ${host}`);
	}
	let file = `bun-${std.triple.os(host)}-${arch}`;
	let checksum = binaryChecksums[std.triple.archAndOs(host)];
	tg.assert(checksum, `unsupported host ${host}`);
	let url = `https://github.com/oven-sh/bun/releases/download/${tag}/${file}.zip`;
	let dload = await std.download({ url, checksum }).then(tg.Directory.expect);
	let bun = await dload.get(`${file}/bun`).then(tg.File.expect);
	return tg.directory({
		"bin/bun": std.wrap(bun),
		"bin/bunx": tg.symlink("bun"),
	});
});

export default toolchain;

// Taken from https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt.asc
let binaryChecksums: { [key: string]: tg.Checksum } = {
	["aarch64-linux"]:
		"sha256:fc528238c429f9b2951eb86f50b95a9ae6920bf295be4e2c155104ba8497eb3e",
	["x86_64-linux"]:
		"sha256:e82b9fcbbe84a67a4c0c2246571219d16b5f00b0fa891928efe3538491bdbf96",
	["aarch64-darwin"]:
		"sha256:c2ffa8c149008b324ff621cb60509873fa8816efdce1b7870226dd1bdd31415d",
	["x86_64-darwin"]:
		"sha256:a748bc18f0faff981568da44a83b52554f223c22e8195765a68a38ebdfa93e9c",
};

export let test = tg.target(async () => {
	let bun = toolchain();
	let version = await $`bun --version | tee $OUTPUT`
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
