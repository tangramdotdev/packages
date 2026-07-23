import * as std from "../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/texinfo/",
	license: "GPL-3.0-or-later",
	name: "texinfo",
	repository: "https://git.savannah.gnu.org/git/texinfo.git",
	version: "7.3",
	tag: "texinfo/7.3",
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

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:51f74eb0f51cfa9873b85264dfdd5d46e8957ec95b88f0fb762f63d9e164c72e";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
}

export type Arg = {
	bootstrap?: boolean;
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	perlArtifact: tg.Directory;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(arg: tg.Unresolved<Arg>) {
	const {
		bootstrap = false,
		build,
		env: env_,
		host,
		perlArtifact,
		sdk,
		source: source_,
	} = await tg.resolve(arg);
	const env = std.env.arg(env_ ?? null, { utils: false });

	const shellScripts = [
		"bin/pdftexi2dvi",
		"bin/texi2dvi",
		"bin/texi2pdf",
		"bin/texindex",
	];
	const output = await std.utils.autotoolsInternal({
		build: build ?? null,
		host: host ?? null,
		bootstrap,
		env,
		processName: metadata.name,
		sdk: sdk ?? null,
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
}

export default build;
