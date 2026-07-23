import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://sourceware.org/libffi/",
	license: "https://github.com/libffi/libffi/blob/master/LICENSE",
	name: "libffi",
	repository: "https://github.com/libffi/libffi",
	version: "3.7.1",
	tag: "libffi/3.7.1",
	provides: {
		docs: [
			"info/libffi.info",
			"man/man3/ffi.3",
			"man/man3/ffi_call.3",
			"man/man3/ffi_prep_cif.3",
			"man/man3/ffi_prep_cif_var.3",
		],
		headers: ["ffi.h"],
		libraries: ["ffi"],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:d5e9a6638ddbd2513ddb54518eb67e4bbe6fa707bcc01c10f6212f0a088d819d";
	const owner = name;
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
}

export type Arg = std.autotools.Arg;

export function build(...args: std.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-multi-os-directory",
						"--enable-portable-binary",
					],
				},
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
