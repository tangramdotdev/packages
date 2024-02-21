import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "bash",
	version: "5.2.15",
};

export let source = tg.target(async (arg?: Arg) => {
	let { name, version } = metadata;
	let build = arg?.build ? tg.triple(arg?.build) : await tg.Triple.host();
	let env = std.env.object([std.sdk({ host: build }, arg?.sdk), arg?.env]);

	let checksum =
		"sha256:13720965b5f4fc3a0d4b61dd37e7565c741da9a5be24edc2ae00182fc1b3588c";
	let source = std.download.fromGnu({ name, version, checksum });
	// See https://lists.gnu.org/archive/html/bug-bash/2022-10/msg00000.html
	// We don't have autoreconf available so we additionally manually resolve the configure script change. The m4 change isn't used, just here for completeness.
	// Once this fix is adopted upstream, we can remove this workaround.
	let script = tg`
		cp -R ${source} $OUTPUT
		chmod -R u+w $OUTPUT
		sed -i 's/if test $bash_cv_func_strtoimax = yes; then/if test $bash_cv_func_strtoimax = no; then/' $OUTPUT/m4/strtoimax.m4
		sed -i 's/if test $bash_cv_func_strtoimax = yes; then/if test $bash_cv_func_strtoimax = no ; then/' $OUTPUT/configure
	`;
	let patchedSource = tg.Directory.expect(
		await tg.build(script, {
			env,
			host: tg.Triple.archAndOs(build),
		}),
	);
	return patchedSource;
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let bash = tg.target((arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--without-bash-malloc"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(() => {
	return std.build(tg`
		mkdir -p $OUTPUT
		echo "Checking that we can run bash scripts." > $OUTPUT/log.txt
		${bash()}/bin/bash -c "echo 'Hello, world!' > $OUTPUT/hello.txt"
	`);
});

export default bash;
