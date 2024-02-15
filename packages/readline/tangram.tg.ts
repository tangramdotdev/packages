import ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "readline",
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
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let readline = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, env: env_, host, source: source_, ...rest } = arg ?? {};

	let env = [ncurses(arg), env_];

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default readline;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against libreadline."
			cc ${source}/main.c -o $OUTPUT -lreadline -lncurses
		`,
		{ env: [std.sdk(), ncurses(), readline()] },
	);
});
