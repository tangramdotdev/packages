import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.nasm.us/",
	name: "nasm",
	repository: "https://github.com/netwide-assembler/nasm",
	version: "3.02",
	tag: "nasm/3.02",
	provides: {
		binaries: ["nasm", "ndisasm"],
	},
};

export async function source() {
	std.download;
	const { name, version } = metadata;
	const checksum =
		"sha256:f504227b2f529e658d41629075f0503b38d67d790af345f34eba4af60c6a5998";
	return std
		.download({
			url: `https://www.nasm.us/pub/${name}/releasebuilds/${version}/nasm-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export function build(...args: std.Args<Arg>) {
	return std.autotools.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	// nasm and ndisasm use -v for version, not --version.
	return await std.assert.pkg(build, {
		binaries: [
			{ name: "nasm", testArgs: ["-v"], snapshot: metadata.version },
			{ name: "ndisasm", testArgs: ["-v"], snapshot: metadata.version },
		],
	});
}
