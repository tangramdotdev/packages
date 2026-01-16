import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	license: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	name: "readline",
	repository: "http://git.savannah.gnu.org/cgit/readline.git/log/",
	version: "8.3",
	tag: "readline/8.3",
	provides: {
		libraries: ["history", "readline"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:fe5383204467828cd495ee8d1d3c037a7eba1389c22bc6a041f627976f9061cc";
	return std.download.fromGnu({ name, version, checksum });
};

const deps = () =>
	std.deps({
		ncurses: ncurses.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<ReturnType<typeof deps>>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			deps: deps(),
			source: source(),
			env: { CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
			phases: {
				configure: {
					args: [
						"--with-curses",
						"--disable-install-examples",
						"--enable-multibyte",
					],
				},
			},
		},
		...args,
	);

	// FIXME - how do I use this flag with cross compilation?
	let phases = arg.phases;
	if (arg.build === arg.host) {
		phases = await std.phases.arg(phases, {
			configure: { args: ["--with-shared-termcap-library"] },
		});
	}

	return std.autotools.build({ ...arg, phases });
};

export default build;

export const test = async () => {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["history", "readline"], {
			runtimeDeps: [ncurses.build()],
		}),
	};
	return await std.assert.pkg(build, spec);
};
