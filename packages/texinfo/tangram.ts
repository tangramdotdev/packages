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
	version: "7.1.1",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:31ae37e46283529432b61bee1ce01ed0090d599e606fc6a29dca1f77c76a6c82";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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

	const perlArtifact = await perl.default_(
		{ build, env: env_, host, sdk },
		perlArg,
	);
	const dependencies = [
		bison.default_({ build, host: build }, bisonArg),
		m4.default_({ build, host: build }, m4Arg),
		ncurses.default_({ build, env: env_, host, sdk }, ncursesArg),
		perlArtifact,
		zlib.default_({ build, env: env_, host, sdk }, zlibArg),
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

export default default_;

export const test = tg.target(async () => {
	return (
		await tg.target(
			tg`
				echo "Checking that we can run texinfo."
				install-info --version
				makeinfo --version
				pdftexi2dvi --version
				pod2texi --version
				texi2any --version
				texi2dvi --version
				texi2pdf --version
				texindex --version
			`,
			{
				env: std.env.arg(default_()),
			},
		)
	).output();
});
