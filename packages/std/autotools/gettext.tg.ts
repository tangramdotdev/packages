import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import progrelocFix from "./gettext-progreloc-fix.patch" with { type: "file" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gettext",
	license: "GPL-3.0-or-later",
	name: "gettext",
	repository: "https://git.savannah.gnu.org/git/gettext.git",
	version: "1.0",
	tag: "gettext/1.0",
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
		"sha256:71132a3fb71e68245b8f2ac4e9e97137d3e5c02f415636eb508ae607bc01add7";
	const source = std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
	return bootstrap.patch(source, progrelocFix);
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

	const env = std.env.arg(env_, { utils: false });

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-fast-install",
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
		build,
		host,
		bootstrap: bootstrap_,
		env,
		phases,
		processName: metadata.name,
		sdk,
		source: source_ ?? source(),
	});
};

export default build;
