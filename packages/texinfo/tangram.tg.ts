import * as std from "tg:std" with { path: "../std" };

type Args = {
	source?: tg.Artifact;
	host?: std.Triple.Arg;
	target?: std.Triple.Arg;
};

export let metadata = {
	name: "texinfo",
	version: "6.8",
	checksum:
		"sha256:8e09cf753ad1833695d2bac0f57dc3bd6bcbbfbf279450e1ba3bc2d7fb297d08",
};

export let source = tg.target(() => std.download.fromGnu(metadata));

export let texinfo = tg.target(async (args?: Args) => {
	let host = std.Triple.host({ host: args?.host });
	let target = std.Triple.target({ host: args?.host, target: args?.target });

	let build = await autotools.build({
		source: args?.source ?? source(),
		copySource: true,
		host,
		target,
	});

	let perl = tg.File.expect(
		await (await autotools.perl.perl()).get("bin/perl"),
	);

	let binDir = tg.directory({
		["bin/install-info"]: build.get("bin/install-info"),
		["bin/pod2texi"]: std.wrap({
			executable: tg.File.expect(await build.get("bin/pod2texi")),
			interpreter: perl,
		}),
		["bin/texi2any"]: std.wrap({
			executable: tg.File.expect(await build.get("bin/texi2any")),
			interpreter: perl,
		}),
		["bin/makeinfo"]: tg.symlink("texi2any"),
	});

	let shellScripts = ["pdftexi2dvi", "texi2dvi", "texi2pdf", "texindex"];

	for (let script of shellScripts) {
		let scriptFile = tg.File.expect(await build.get(`bin/${script}`));
		binDir = tg.directory(binDir, {
			[`bin/${script}`]: std.wrap(scriptFile),
		});
	}

	let perlLibPaths = [
		tg`${build}/share/texinfo/lib/Text-Unidecode/lib`,
		tg`${build}/share/texinfo/lib/Unicode-EastAsianWidth/lib`,
		tg`${build}/share/texinfo/lib/libintl-perl/lib`,
		tg`${build}/share/texinfo/Pod-Simple-Texinfo`,
		tg`${build}/share/texinfo`,
	];

	return std.env(binDir, {
		PERL5LIB: {
			value: tg.Template.join(":", ...perlLibPaths),
			kind: "append",
			separator: ":",
		},
		TEXINDEX_SCRIPT: {
			value: tg`${build}/share/texinfo/texindex.awk`,
			kind: "set_if_unset",
		},
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
