import * as bash from "bash" with { local: "./bash.tg.ts" };
import * as gnused from "gnused" with { local: "./gnused.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/findutils/",
	name: "findutils",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/cgit/findutils.git",
	version: "4.10.0",
	tag: "findutils/4.10.0",
	provides: {
		binaries: ["find", "locate", "updatedb", "xargs"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const compression = "xz";
	const checksum =
		"sha256:1387e0b67ff247d2abde998f90dfbf70c1491391a59ddfecb8ae698789f0a4f5";
	return std.download.fromGnu({ name, version, checksum, compression });
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg({ source: source() }, ...args);
	let output = await std.autotools.build(arg);

	// updatedb is a shell script that uses sed for argument parsing.
	// Wrap it with bash and provide sed so it works outside the build env.
	const updatedb = tg.File.expect(await output.get("bin/updatedb"));
	const sedArtifact = await gnused.build({ host: arg.host });
	output = await tg.directory(output, {
		"bin/updatedb": bash.wrapScript(updatedb, arg.host, {
			SED: tg.Mutation.setIfUnset(
				tg`${sedArtifact}/bin/sed`,
			),
		}),
	});

	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
