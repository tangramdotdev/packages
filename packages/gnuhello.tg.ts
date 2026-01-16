import * as gettext from "gettext" with { local: "./gettext.tg.ts" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/hello/",
	license: "GPL-3.0-or-later",
	name: "hello",
	repository: "https://git.savannah.gnu.org/cgit/hello.git",
	version: "2.12.1",
	tag: "hello/2.12.1",
	provides: {
		binaries: ["hello"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8d99142afd92576f30b0cd7cb42a8dc6809998bc5d607d88761f512e26c7db20";
	return std.download.fromGnu({ name, version, checksum });
};

const deps = () =>
	std.deps({
		gettext: { build: gettext.build, kind: "buildtime" },
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: (ctx) => std.triple.os(ctx.host) === "darwin",
		},
	});

export type Arg = std.autotools.Arg & std.deps.Arg<ReturnType<typeof deps>>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps: deps(),
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
