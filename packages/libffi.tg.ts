import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://sourceware.org/libffi/",
	license: "https://github.com/libffi/libffi/blob/master/LICENSE",
	name: "libffi",
	repository: "https://github.com/libffi/libffi",
	version: "3.4.8",
	tag: "libffi/3.4.8",
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

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:bc9842a18898bfacb0ed1252c4febcc7e78fa139fd27fdc7a3e30d9d9356119b";
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
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg(
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
		),
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
