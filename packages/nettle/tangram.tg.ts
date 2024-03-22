import gmp from "tg:gmp" with { path: "../gmp" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "nettle",
	version: "3.8.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:364f3e2b77cd7dcde83fd7c45219c834e54b0c75e428b6f894a23d12dd41cbfe";
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

export let nettle = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let env = [gmp(arg), env_];

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-documentation",
			"--libdir=$OUTPUT/lib",
		],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default nettle;

export let test = tg.target(() => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against nettle and hogweed."
			cc ${source}/main.c -o $OUTPUT -lnettle -lhogweed -lgmp
		`,
		{ env: [std.sdk(), nettle(), gmp()] },
	);
});
