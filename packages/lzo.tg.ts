import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://www.oberhumer.com/opensource/lzo/",
	license: "GPL-2.0-or-later",
	name: "lzo",
	repository: "https://www.oberhumer.com/opensource/lzo/",
	version: "2.10",
	tag: "lzo/2.10",
	provides: {
		libraries: ["lzo2"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:c0f892943208266f9b6543b3ae308fab6284c5c90e627931446fb49b4221a072";
	return std
		.download({
			url: `https://www.oberhumer.com/opensource/${name}/download/${name}-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			phases: { configure: { args: ["--enable-shared"] } },
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
