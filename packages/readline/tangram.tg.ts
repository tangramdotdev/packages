import ncurses from "tg:ncurses" with { path: "../ncurses" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	license: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	name: "readline",
	repository: "http://git.savannah.gnu.org/cgit/readline.git/log/",
	version: "8.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3feb7171f16a84ee82ca18a36d7b9be109a52c04f492a053331d7d1095007c35";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let readline = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let env = [
		ncurses({ ...rest, build, env: env_, host }),
		pkgconfig({ ...rest, build, env: env_, host }),
		env_,
	];

	let configure = {
		args: [
			"--with-curses",
			"--disable-install-examples",
			"--with-shared-termcap-library",
		],
	};
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Patch pc files to add tinfo as `Requires` instead of Requires.private`.
	let libNames = ["history", "readline"];
	await Promise.all(
		libNames.map(async (name) => {
			let pc = tg.File.expect(await output.get(`lib/pkgconfig/${name}.pc`));
			let content = await pc.text();
			let lines = content.split("\n");
			lines = lines.map((line) => {
				if (line.startsWith("Requires.private: tinfo")) {
					return `Requires: tinfo`;
				} else {
					return line;
				}
			});
			output = await tg.directory(output, {
				[`lib/pkgconfig/${name}.pc`]: tg.file(lines.join("\n")),
			});
		}),
	);

	return output;
});

export default readline;

export let test = tg.target(async () => {
	let artifact = readline();
	await std.assert.pkg({
		buildFunction: readline,
		metadata,
	});
	return artifact;
});
