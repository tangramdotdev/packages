import * as bash from "tg:bash" with { path: "../bash" };
import bison from "tg:bison" with { path: "../bison" };
import m4 from "tg:m4" with { path: "../m4" };
import ncurses from "tg:ncurses" with { path: "../ncurses" };
import perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.gnu.org/software/texinfo/",
	license: "GPL-3.0-or-later",
	name: "texinfo",
	repository: "https://git.savannah.gnu.org/git/texinfo.git",
	version: "7.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:deeec9f19f159e046fdf8ad22231981806dac332cc372f1c763504ad82b30953";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let texinfo = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let perlArtifact = await perl(arg);
	let dependencies = [
		bison(arg),
		m4(arg),
		ncurses(arg),
		perlArtifact,
		zlib(arg),
	];
	let env = [...dependencies, env_];

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);

	let interpreter = tg.File.expect(await perlArtifact.get("bin/perl"));

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

	let shellScripts = ["pdftexi2dvi", "texi2dvi", "texi2pdf", "texindex"];

	for (let script of shellScripts) {
		let scriptFile = tg.File.expect(await output.get(`bin/${script}`));
		binDir = tg.directory(binDir, {
			[`bin/${script}`]: bash.wrapScript(scriptFile),
		});
	}

	let perlLibPaths = [
		tg`${output}/share/texinfo/lib/Text-Unidecode/lib`,
		tg`${output}/share/texinfo/lib/Unicode-EastAsianWidth/lib`,
		tg`${output}/share/texinfo/lib/libintl-perl/lib`,
		tg`${output}/share/texinfo/Pod-Simple-Texinfo`,
		tg`${output}/share/texinfo`,
	];

	return std.env(binDir, {
		PERL5LIB: tg.Mutation.templateAppend(
			tg.Template.join(":", ...perlLibPaths),
			":",
		),
		TEXINDEX_SCRIPT: tg.Mutation.setIfUnset(
			tg`${output}/share/texinfo/texindex.awk`,
		),
	});
});

export default texinfo;

export let test = tg.target(() => {
	return tg.build(
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
			env: std.env.object(texinfo()),
		},
	);
});
