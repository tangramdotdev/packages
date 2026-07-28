import * as bash from "bash" with { source: "./bash.tg.ts" };
import coreutils from "coreutils" with { source: "./coreutils.tg.ts" };
import * as gnused from "gnused" with { source: "./gnused.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/findutils/",
	name: "findutils",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/cgit/findutils.git",
	version: "4.11.0",
	tag: "findutils/4.11.0",
	provides: {
		binaries: ["find", "locate", "updatedb", "xargs"],
	},
};

function source() {
	const { name, version } = metadata;
	const compression = "xz";
	const checksum =
		"sha256:bfd19cb06cc71f3352d567e90284d8cdac02ac89774bbeadf0b533b0c11432fd";
	return std.download.fromGnu({ name, version, checksum, compression });
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg({ source: source() }, ...args);
	let output = await std.autotools.build(arg);

	// updatedb is a shell script that uses sed, sort, cat, and other
	// coreutils at runtime. Wrap it with bash and provide those tools.
	const updatedb = tg.File.expect(await output.get("bin/updatedb"));
	const sedArtifact = await gnused.build({ host: arg.host });
	const coreutilsArtifact = await coreutils({ host: arg.host });
	const updatedbEnv = std.env.arg(sedArtifact, coreutilsArtifact, {
		SED: tg.Mutation.setIfUnset(tg`${sedArtifact}/bin/sed`),
	});
	output = await tg.directory(output, {
		"bin/updatedb": bash.wrapScript(updatedb, arg.host, updatedbEnv),
	});

	return output;
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		// The locate binary calls setgid() to drop group privileges before
		// processing arguments, which fails in the sandbox with EPERM.
		binaries: std.assert.binaries(metadata.provides.binaries, {
			locate: { exitOnErr: false },
		}),
	};
	return await std.assert.pkg(build, spec);
}
