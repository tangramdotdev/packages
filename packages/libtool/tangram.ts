import * as std from "std" with { path: "../std" };
import * as bash from "bash" with { path: "../bash" };
import * as grep from "gnugrep" with { path: "../gnugrep" };
import * as sed from "gnused" with { path: "../gnused" };

export const metadata = {
	homepage: "https://www.gnu.org/software/libtool",
	license: "GPL-3.0-or-later",
	name: "libtool",
	repository: "https://git.savannah.gnu.org/git/libtool.git",
	version: "2.5.4",
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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const env = std.env.arg(env_);
	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
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
			["_lt_pkgdatadir"]: tg.Mutation.setIfUnset(tg`${output}/share/libtool`),
			EGREP: tg.Mutation.setIfUnset(tg`${grepExe} -E`),
			FGREP: tg.Mutation.setIfUnset(tg`${grepExe} -F`),
			GREP: tg.Mutation.setIfUnset(grepExe),
			SED: tg.Mutation.setIfUnset(sedExe),
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
