import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.nasm.us/",
	name: "nasm",
	repository: "https://github.com/netwide-assembler/nasm",
	version: "3.01",
	tag: "nasm/3.01",
	provides: {
		binaries: ["nasm", "ndisasm"],
	},
};

export const source = async () => {
	std.download;
	const { name, version } = metadata;
	const checksum =
		"sha256:aea120d4adb0241f08ae24d6add09e4a993bc1c4d9f754dbfc8020d6916c9be1";
	return std
		.download({
			url: `https://www.nasm.us/pub/${name}/releasebuilds/${version}/nasm-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	// nasm and ndisasm use -v for version, not --version.
	return await std.assert.pkg(build, {
		binaries: [
			{ name: "nasm", testArgs: ["-v"], snapshot: metadata.version },
			{ name: "ndisasm", testArgs: ["-v"], snapshot: metadata.version },
		],
	});
};
