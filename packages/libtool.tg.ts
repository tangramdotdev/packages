import * as std from "std" with { local: "./std" };
import * as bash from "bash" with { local: "./bash.tg.ts" };
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

	const bashScripts = ["libtool", "libtoolize"];
	for (const script of bashScripts) {
		const file = tg.File.expect(await output.get(`bin/${script}`));
		let grepArtifact = await grep.build({ host });
		let grepExe = await grepArtifact.get("bin/grep").then(tg.File.expect);
		let sedArtifact = await sed.build({ host });
		let sedExe = await sedArtifact.get("bin/sed").then(tg.File.expect);
		const scriptEnv = {
			["_lt_pkgdatadir"]: tg.Mutation.setIfUnset<tg.Template.Arg>(
				tg`${output}/share/libtool`,
			),
			EGREP: tg.Mutation.setIfUnset<tg.Template.Arg>(tg`${grepExe} -E`),
			FGREP: tg.Mutation.setIfUnset<tg.Template.Arg>(tg`${grepExe} -F`),
			GREP: tg.Mutation.setIfUnset<tg.Template.Arg>(grepExe),
			SED: tg.Mutation.setIfUnset<tg.Template.Arg>(sedExe),
		};
		output = await tg.directory(output, {
			[`bin/${script}`]: bash.wrapScript(file, host, scriptEnv),
		});
	}

	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
