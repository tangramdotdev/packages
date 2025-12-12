import * as acl from "acl" with { local: "./acl.tg.ts" };
import * as attr from "attr" with { local: "./attr" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as xz from "xz" with { local: "./xz.tg.ts" };

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
		headers: [
			// FIXME - - cannot find `<sting>`, c++ header.
			// 	"autosprintf.h",
			"gettext-po.h",
			"libintl.h",
			"textstyle/stdbool.h",
			"textstyle/version.h",
			"textstyle/woe32dll.h",
			"textstyle.h",
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

const deps = await std.deps({
	acl: {
		build: acl.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "linux",
	},
	attr: {
		build: attr.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "linux",
	},
	libiconv: {
		build: libiconv.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "darwin",
	},
	ncurses: ncurses.build,
	xz: { build: xz.build, kind: "buildtime" },
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			env: {
				CFLAGS: tg.Mutation.suffix("-Wno-incompatible-pointer-types", " "),
			},
		},
		...args,
	);

	const os = std.triple.os(arg.host);
	const configureArgs = [
		"--disable-dependency-tracking",
		"--enable-relocatable",
		"--with-included-glib",
		"--with-included-libcroco",
		"--with-included-libunistring",
		"--with-included-libxml",
		"--without-emacs",
		"--without-git",
	];
	if (os === "darwin") {
		// NOTE - this bundles libintl.h, which is provided on Linux by glibc.
		configureArgs.push("--with-included-gettext");
		// Allow the build process to locate libraries from the compile-time library path.
		configureArgs.push("DYLD_FALLBACK_LIBRARY_PATH=$LIBRARY_PATH");
	}
	const phases = std.phases.mergePhases(arg.phases, {
		configure: { args: configureArgs },
	});

	return std.autotools.build({ ...arg, phases });
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
