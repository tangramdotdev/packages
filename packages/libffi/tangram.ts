import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://sourceware.org/libffi/",
	license: "https://github.com/libffi/libffi/blob/master/LICENSE",
	name: "libffi",
	repository: "https://github.com/libffi/libffi",
	version: "3.4.8",
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

export const source = async (): Promise<tg.Directory> => {
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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-multi-os-directory",
			"--enable-portable-binary",
		],
	};

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
