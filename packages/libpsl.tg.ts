import * as libiconv from "libiconv" with { source: "./libiconv.tg.ts" };
import * as python from "python" with { source: "./python" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://rockdaboot.github.io/libpsl/",
	license: "MIT",
	name: "libpsl",
	repository: "https://github.com/rockdaboot/libpsl",
	version: "0.23.0",
	tag: "libpsl/0.23.0",
	provides: {
		libraries: ["psl"],
	},
};

export async function source(): Promise<tg.Directory> {
	const { name, version } = metadata;
	const checksum =
		"sha256:f39b9631b3d369a21259ea4654f8875c0ec6995ce9551c0eb5d423e4c011f911";
	const owner = "rockdaboot";
	const repo = name;
	const tag = version;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
}

export function deps() {
	return std.deps({
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: { hostOs: "darwin" },
		},
		python: { build: python.self, kind: "buildtime" },
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-nls",
						"--disable-rpath",
					],
				},
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const os = std.triple.os(std.triple.host());
	const runtimeDeps: Array<tg.Unresolved<tg.Directory>> = [];
	if (os === "darwin") {
		runtimeDeps.push(libiconv.build());
	}
	const spec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(metadata.provides.libraries, {
			runtimeDeps,
		}),
	};
	return await std.assert.pkg(build, spec);
}
