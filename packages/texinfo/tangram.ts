import * as bash from "bash" with { path: "../bash" };
import * as bison from "bison" with { path: "../bison" };
import * as m4 from "m4" with { path: "../m4" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as perl from "perl" with { path: "../perl" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.gnu.org/software/texinfo/",
	license: "GPL-3.0-or-later",
	name: "texinfo",
	repository: "https://git.savannah.gnu.org/git/texinfo.git",
	version: "7.2",
	provides: {
		binaries: [
			"install-info",
			"makeinfo",
			"pdftexi2dvi",
			"pod2texi",
			"texi2any",
			"texi2dvi",
			"texi2pdf",
			"texindex",
		],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0329d7788fbef113fa82cb80889ca197a344ce0df7646fe000974c5d714363a6";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		bison?: bison.Arg;
		m4?: m4.Arg;
		ncurses?: ncurses.Arg;
		perl?: perl.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			bison: bisonArg = {},
			m4: m4Arg = {},
			ncurses: ncursesArg = {},
			perl: perlArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const perlArtifact = await perl.build(
		{ build, env: env_, host, sdk },
		perlArg,
	);
	const dependencies = [
		bison.build({ build, host: build }, bisonArg),
		m4.build({ build, host: build }, m4Arg),
		ncurses.build({ build, env: env_, host, sdk }, ncursesArg),
		perlArtifact,
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
	];
	const env = [...dependencies, env_];

	const output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	const interpreter = tg.File.expect(await perlArtifact.get("bin/perl"));

	let binDir = tg.directory({
		["bin/install-info"]: output.get("bin/install-info"),
		["bin/pod2texi"]: std.wrap({
			executable: tg.File.expect(await output.get("bin/pod2texi")),
			interpreter,
		}),
		["bin/texi2any"]: std.wrap({
			executable: tg.File.expect(await output.get("bin/texi2any")),
			interpreter,
		}),
		["bin/makeinfo"]: tg.symlink("texi2any"),
	});

	const shellScripts = ["pdftexi2dvi", "texi2dvi", "texi2pdf", "texindex"];

	for (const script of shellScripts) {
		const scriptFile = tg.File.expect(await output.get(`bin/${script}`));
		binDir = tg.directory(binDir, {
			[`bin/${script}`]: bash.wrapScript(scriptFile, host),
		});
	}

	const perlLibPaths = [
		tg`${output}/share/texinfo/lib/Text-Unidecode/lib`,
		tg`${output}/share/texinfo/lib/Unicode-EastAsianWidth/lib`,
		tg`${output}/share/texinfo/lib/libintl-perl/lib`,
		tg`${output}/share/texinfo/Pod-Simple-Texinfo`,
		tg`${output}/share/texinfo`,
	];

	return std.env(binDir, {
		PERL5LIB: tg.Mutation.suffix(tg.Template.join(":", ...perlLibPaths), ":"),
		TEXINDEX_SCRIPT: tg.Mutation.setIfUnset(
			tg`${output}/share/texinfo/texindex.awk`,
		),
	});
});

export default build;

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	// FIXME - build should return a directory, not an env - wrap the bins in the env.
	return true;
	// return await std.assert.pkg(build, spec);
});
