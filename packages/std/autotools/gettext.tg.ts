import * as std from "../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/gettext",
	license: "GPL-3.0-or-later",
	name: "gettext",
	repository: "https://git.savannah.gnu.org/git/gettext.git",
	version: "0.26",
	tag: "gettext/0.26",
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

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:d1fb86e260cfe7da6031f94d2e44c0da55903dbae0a2fa0fae78c91ae1b56f00";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
};

export type Arg = {
	bootstrap?: boolean;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const os = std.triple.os(host);

	const envs: Array<tg.Unresolved<std.env.Arg>> = [
		{
			CFLAGS: tg.Mutation.suffix("-Wno-incompatible-pointer-types", " "),
		},
	];

	const env = std.env.arg(...envs, env_, { utils: false });

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
		bootstrap: bootstrap_,
		env,
		phases,
		sdk,
		source: source_ ?? source(),
	});
};

export default build;
