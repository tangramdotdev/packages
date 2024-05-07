import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "bash",
	version: "5.2.21",
};

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let source = tg.target(async (arg?: Arg) => {
	let { name, version } = metadata;
	let build = arg?.build ?? (await std.triple.host());
	let env = std.env.object(bootstrap.sdk(), arg?.env);

	let checksum =
		"sha256:c8e31bdc59b69aaffc5b36509905ba3e5cbb12747091d27b4b977f078560d5b8";
	let source = std.download.fromGnu({ name, version, checksum });
	// See https://lists.gnu.org/archive/html/bug-bash/2022-10/msg00000.html
	// We don't have autoreconf available so we additionally manually resolve the configure script change. The m4 change isn't used, just here for completeness.
	// Once this fix is adopted upstream, we can remove this workaround.
	let prepare = tg`cp -R ${source} $OUTPUT && chmod -R u+w $OUTPUT`;
	let fixup = tg`
		sed -i 's/if test $bash_cv_func_strtoimax = yes; then/if test $bash_cv_func_strtoimax = no; then/' $OUTPUT/m4/strtoimax.m4
		sed -i 's/if test $bash_cv_func_strtoimax = yes; then/if test $bash_cv_func_strtoimax = no ; then/' $OUTPUT/configure
	`;
	let patchedSource = tg.Directory.expect(
		await std.phases.build({
			env,
			phases: { prepare, fixup },
			target: { host: std.triple.archAndOs(build) },
		}),
	);
	return patchedSource;
});

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configureArgs = ["--without-bash-malloc", "--disable-nls"];

	// If the provided env has ncurses in the library path, use it instead of termcap.
	if (await providesNcurses(env_)) {
		configureArgs.push("--with-curses");
	}

	let configure = {
		args: configureArgs,
	};
	let phases = { configure };

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	env.push(prerequisites(host));
	env.push(bootstrap.shell(host));
	env.push({
		CFLAGS: tg.Mutation.templatePrepend(
			"-Wno-implicit-function-declaration",
			" ",
		),
	});

	let output = buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(arg),
		},
		autotools,
	);

	output = tg.directory(output, {
		"bin/sh": tg.symlink("bash"),
	});

	return output;
});

export default build;

let providesNcurses = async (env: std.env.Arg): Promise<boolean> => {
	for await (let [_, dir] of std.env.dirsInVar({
		env,
		key: "LIBRARY_PATH",
	})) {
		for await (let [name, _] of dir) {
			if (name.includes("libncurses")) {
				return true;
			}
		}
	}
	return false;
};

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["bash"],
		metadata,
		sdk,
	});
	return true;
});
