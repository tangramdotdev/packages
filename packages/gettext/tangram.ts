import * as acl from "acl" with { local: "../acl.tg.ts" };
import * as attr from "attr" with { local: "../attr" };
import * as bash from "bash" with { local: "../bash.tg.ts" };
import coreutils from "coreutils" with { local: "../coreutils.tg.ts" };
import * as gnugrep from "gnugrep" with { local: "../gnugrep.tg.ts" };
import * as gnused from "gnused" with { local: "../gnused.tg.ts" };
import * as libiconv from "libiconv" with { local: "../libiconv.tg.ts" };
import * as ncurses from "ncurses" with { local: "../ncurses.tg.ts" };
import * as std from "std" with { local: "../std" };
import * as xz from "xz" with { local: "../xz.tg.ts" };
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
		"sha256:71132a3fb71e68245b8f2ac4e9e97137d3e5c02f415636eb508ae607bc01add7";
	const source = std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
	return std.patch(source, progrelocFix);
};

export const deps = () =>
	std.deps({
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
		},
		...args,
	);

	const os = std.triple.os(arg.host);
	const configureArgs = [
		"--disable-dependency-tracking",
		"--enable-relocatable",
		"--enable-fast-install",
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
	} else {
		// On Linux, use glibc's built-in iconv instead of GNU libiconv.
		// Without this, configure detects libiconv from the SDK and links
		// against it, but the wrapper does not propagate the transitive
		// dependency to all tools.
		configureArgs.push("--without-libiconv-prefix");
	}
	const phases = std.phases.arg(arg.phases, {
		configure: { args: configureArgs },
	});

	let output = await std.autotools.build({ ...arg, phases });

	// Wrap shell scripts with a Tangram-managed bash interpreter.
	// These scripts call sed, grep, and coreutils (cat, basename, etc.)
	// at runtime, so include those tools in the wrapper env.
	const sedArtifact = await gnused.build({ host: arg.host });
	const grepArtifact = await gnugrep.build({ host: arg.host });
	const coreutilsArtifact = await coreutils({ host: arg.host });
	const scriptEnv = std.env.arg(sedArtifact, grepArtifact, coreutilsArtifact);

	const shellScripts = ["autopoint", "gettext.sh", "gettextize"];
	for (const script of shellScripts) {
		const file = tg.File.expect(await output.get(`bin/${script}`));
		output = await tg.directory(output, {
			[`bin/${script}`]: bash.wrapScript(file, arg.host, scriptEnv),
		});
	}

	// The recode-sr-latin sub-project configure still links against
	// libiconv despite --without-libiconv-prefix. Add the missing
	// transitive library paths (libiconv, libacl, libattr) to its wrapper.
	if (os === "linux") {
		const { acl: aclArtifact, attr: attrArtifact } = await std.deps.artifacts(
			deps,
			arg,
		);
		const recodeBin = tg.File.expect(await output.get("bin/recode-sr-latin"));
		output = await tg.directory(output, {
			"bin/recode-sr-latin": std.wrap(recodeBin, {
				libraryPaths: [
					tg`${aclArtifact}/lib`,
					tg`${attrArtifact}/lib`,
					tg`${await libiconv.build({ host: arg.host })}/lib`,
				],
			}),
		});
	}

	return output;
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		// gettext.sh is a shell library (function definitions), not a
		// runnable command, so skip executing it.
		binaries: std.assert.binaries(metadata.provides.binaries, {
			"gettext.sh": { skipRun: true },
		}),
	};
	// On Linux, libintl.h is provided by glibc, not by this package.
	if (std.triple.os(std.triple.host()) === "linux") {
		if (spec.headers) {
			spec.headers = spec.headers.filter((h) => h !== "libintl.h");
		}
	}
	return await std.assert.pkg(build, spec);
};
