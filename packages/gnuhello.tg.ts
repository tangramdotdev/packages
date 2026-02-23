import * as gettext from "gettext" with { local: "./gettext.tg.ts" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/hello/",
	license: "GPL-3.0-or-later",
	name: "hello",
	repository: "https://git.savannah.gnu.org/cgit/hello.git",
	version: "2.12.2",
	tag: "gnuhello/2.12.2",
	provides: {
		binaries: ["hello"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5a9a996dc292cc24dcf411cee87e92f6aae5b8d13bd9c6819b4c7a9dce0818ab";
	return std.download.fromGnu({ name, version, checksum });
};

export const deps = () =>
	std.deps({
		gettext: { build: gettext.build, kind: "buildtime" },
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: (ctx) => std.triple.os(ctx.host) === "darwin",
		},
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
