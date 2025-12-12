import * as std from "../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/texinfo/",
	license: "GPL-3.0-or-later",
	name: "texinfo",
	repository: "https://git.savannah.gnu.org/git/texinfo.git",
	version: "7.2",
	tag: "texinfo/7.2",
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

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0329d7788fbef113fa82cb80889ca197a344ce0df7646fe000974c5d714363a6";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = {
	bootstrap?: boolean;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	perlArtifact: tg.Directory;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const {
		bootstrap = false,
		build,
		env: env_,
		host,
		perlArtifact,
		sdk,
		source: source_,
	} = await tg.resolve(arg);
	const env = std.env.arg(env_, { utils: false });

	const shellScripts = [
		"bin/pdftexi2dvi",
		"bin/texi2dvi",
		"bin/texi2pdf",
		"bin/texindex",
	];
	const output = await std.utils.autotoolsInternal({
		build,
		host,
		bootstrap,
		env,
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: shellScripts,
	});

	const interpreter = tg.File.expect(await perlArtifact.get("bin/perl"));

	let binDir = tg.directory({
		["bin/install-info"]: output.get("bin/install-info"),
		["bin/pod2texi"]: std.wrap({
			executable: tg.File.expect(await output.get("bin/pod2texi")),
			interpreter,
			buildToolchain: env,
		}),
		["bin/texi2any"]: std.wrap({
			executable: tg.File.expect(await output.get("bin/texi2any")),
			interpreter,
			buildToolchain: env,
		}),
		["bin/makeinfo"]: tg.symlink("texi2any"),
	});

	const perlLibPaths = [
		tg`${output}/share/texinfo/lib/Text-Unidecode/lib`,
		tg`${output}/share/texinfo/lib/Unicode-EastAsianWidth/lib`,
		tg`${output}/share/texinfo/lib/libintl-perl/lib`,
		tg`${output}/share/texinfo/Pod-Simple-Texinfo`,
		tg`${output}/share/texinfo`,
	];

	return std.env.arg(
		binDir,
		{
			PERL5LIB: tg.Mutation.suffix(tg.Template.join(":", ...perlLibPaths), ":"),
			TEXINDEX_SCRIPT: tg.Mutation.setIfUnset(
				tg`${output}/share/texinfo/texindex.awk`,
			),
		},
		{ utils: false },
	);
};

export default build;
