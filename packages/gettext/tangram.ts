import * as acl from "acl" with { path: "../acl" };
import * as attr from "attr" with { path: "../attr" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as std from "std" with { path: "../std" };
import * as xz from "xz" with { path: "../xz" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gettext",
	license: "GPL-3.0-or-later",
	name: "gettext",
	repository: "https://git.savannah.gnu.org/git/gettext.git",
	version: "0.25",
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
		"sha256:05240b29f5b0f422e5a4ef8e9b5f76d8fa059cc057693d2723cdb76f36a88ab0";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		acl?: std.args.DependencyArg<acl.Arg>;
		attr?: std.args.DependencyArg<attr.Arg>;
		libiconv?: std.args.DependencyArg<libiconv.Arg>;
		ncurses?: std.args.DependencyArg<ncurses.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const os = std.triple.os(host);

	const dependencies: Array<std.env.Dependency<any>> = [
		std.env.buildDependency(xz.build),
		std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
	];
	if (os === "linux") {
		dependencies.push(
			std.env.runtimeDependency(acl.build, dependencyArgs.acl),
			std.env.runtimeDependency(attr.build, dependencyArgs.attr),
		);
	}
	if (os === "darwin") {
		dependencies.push(
			std.env.runtimeDependency(libiconv.build, dependencyArgs.libiconv),
		);
	}

	const envs: Array<tg.Unresolved<std.env.Arg>> = [
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
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

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
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
