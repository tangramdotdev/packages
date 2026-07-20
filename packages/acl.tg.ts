import * as attr from "attr" with { source: "./attr" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://savannah.nongnu.org/projects/acl",
	hosts: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "acl",
	repository: "https://git.savannah.nongnu.org/cgit/acl.git",
	version: "2.4.0",
	tag: "acl/2.4.0",
	provides: {
		binaries: ["chacl", "getfacl", "setfacl"],
		headers: ["acl/libacl.h", "sys/acl.h"],
		libraries: ["acl"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:e661131456d2708a01c614a0f400e11d7d1bfaeb6f3e74b75bb980b72f0161a3";
	const base = `https://download.savannah.gnu.org/releases/${name}`;
	const extension = ".tar.xz";
	return std.download
		.extractArchive({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		attr: attr.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: std.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-rpath",
						"--disable-silent-rules",
					],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);

	const isCross = arg.build !== arg.host;
	let env = arg.env ?? null;
	if (isCross) {
		const attrArtifact = await std.deps.artifacts(deps, {
			build: arg.build,
			host: arg.host,
		});
		if (attrArtifact.attr) {
			env = await std.env.arg(env, {
				LDFLAGS: tg.Mutation.prefix(tg`-L${attrArtifact.attr}/lib`, " "),
			});
		}
	}

	return std.autotools.build({ ...arg, env });
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: [],
			snapshot: "Usage:",
			exitOnErr: false,
		}),
		libraries: [{ name: "acl", runtimeDeps: [attr.build()] }],
	};
	return await std.assert.pkg(build, spec);
}
