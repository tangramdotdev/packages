import * as std from "std" with { local: "./std" };
import * as bash from "bash" with { local: "./bash.tg.ts" };
import coreutils from "coreutils" with { local: "./coreutils.tg.ts" };
import * as grep from "gnugrep" with { local: "./gnugrep.tg.ts" };
import * as sed from "gnused" with { local: "./gnused.tg.ts" };

export const metadata = {
	homepage: "https://www.gnu.org/software/libtool",
	license: "GPL-3.0-or-later",
	name: "libtool",
	repository: "https://git.savannah.gnu.org/git/libtool.git",
	version: "2.5.4",
	tag: "libtool/2.5.4",
	provides: {
		binaries: ["libtool", "libtoolize"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f81f5860666b0bc7d84baddefa60d1cb9fa6fceb2398cc3baca6afaa60266675";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
		},
		...args,
	);

	let output = await std.autotools.build(arg);
	const host = arg.host;
	// Add a symlink to the m4 macros.
	output = await tg.directory(output, {
		[`share/libtool/m4`]: tg.symlink("../aclocal"),
	});

	const grepArtifact = await grep.build({ host });
	const sedArtifact = await sed.build({ host });
	const coreutilsArtifact = await coreutils({ host });

	const bashScripts = ["libtool", "libtoolize"];
	for (const scriptName of bashScripts) {
		const rawFile = tg.File.expect(await output.get(`bin/${scriptName}`));

		// The configure step hardcodes absolute paths to build-time tools
		// (e.g. SED="/path/to/sed"). These unconditional assignments
		// override the wrapper's env vars. Patch them to conditional
		// assignments so the wrapper's values take precedence.
		let content = await rawFile.text;
		for (const varName of ["SED", "GREP", "FGREP", "EGREP"]) {
			content = content.replace(
				new RegExp(`^${varName}="([^"]+)"$`, "gm"),
				`${varName}="\${${varName}:-$1}"`,
			);
		}
		const patchedFile = await tg.file({ contents: content, executable: true });

		const scriptEnv = std.env.arg(
			grepArtifact,
			sedArtifact,
			coreutilsArtifact,
			{
				["_lt_pkgdatadir"]: tg.Mutation.setIfUnset(
					tg`${output}/share/libtool`,
				),
				EGREP: tg.Mutation.setIfUnset(
					tg`${grepArtifact}/bin/grep -E`,
				),
				FGREP: tg.Mutation.setIfUnset(
					tg`${grepArtifact}/bin/grep -F`,
				),
				GREP: tg.Mutation.setIfUnset(tg`${grepArtifact}/bin/grep`),
				SED: tg.Mutation.setIfUnset(tg`${sedArtifact}/bin/sed`),
			},
		);
		output = await tg.directory(output, {
			[`bin/${scriptName}`]: bash.wrapScript(
				patchedFile,
				host,
				scriptEnv,
			),
		});
	}

	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
