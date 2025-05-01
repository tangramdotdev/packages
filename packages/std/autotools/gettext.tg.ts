import * as std from "../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/gettext",
	license: "GPL-3.0-or-later",
	name: "gettext",
	repository: "https://git.savannah.gnu.org/git/gettext.git",
	version: "0.24",
	provides: {
		binaries: [
			"autopoint",
			"envsubst",
			"gettext",
			"gettext.sh",
			"gettextize",
			"msgattrib",
			"msgcat",
			"msgcmp",
			"msgcomm",
			"msgconv",
			"msgen",
			"msgexec",
			"msgfilter",
			"msgfmt",
			"msggrep",
			"msginit",
			"msgmerge",
			"msgunfmt",
			"msguniq",
			"ngettext",
			"recode-sr-latin",
			"xgettext",
		],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e1620d518b26d7d3b16ac570e5018206e8b0d725fb65c02d048397718b5cf318";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.command(async (arg?: Arg) => {
	const { build, env: env_, host: host_, sdk, source: source_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const os = std.triple.os(host);

	const envs: Array<tg.Unresolved<std.env.Arg>> = [
		{
			CFLAGS: tg.Mutation.suffix("-Wno-incompatible-pointer-types", " "),
		},
	];

	const env = std.env.arg(...envs, env_);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-relocatable",
			"--with-included-glib",
			"--with-included-libcroco",
			"--with-included-libunistring",
			"--with-included-libxml",
			"--without-emacs",
			"--without-git",
		],
	};
	if (os === "darwin") {
		// NOTE - this bundles libintl.h, which is provided on Linux by glibc.
		configure.args.push("--with-included-gettext");
		// Allow the build process to locate libraries from the compile-time library path.
		configure.args.push("DYLD_FALLBACK_LIBRARY_PATH=$LIBRARY_PATH");
	}

	const phases = { configure };

	return std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		phases,
		sdk,
		source: source_ ?? source(),
	});
});

export default build;
