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
	let build = arg?.build ? std.triple(arg?.build) : await std.Triple.host();
	let env = std.env.object(
		std.sdk({ host: build, bootstrapMode: arg?.bootstrapMode }, arg?.sdk),
		arg?.env,
	);

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
			host: std.Triple.system(build),
		}),
	);
	return patchedSource;
});

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		bootstrapMode,
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;


	let configureArgs = ["--without-bash-malloc", "--disable-nls"];
	if (!bootstrapMode) {
		configureArgs.push("--with-curses");
	}
	let configure = {
		args: configureArgs,
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [];
	if (bootstrapMode) {
		env.push(prerequisites({ host }));
		env.push(bootstrap.shell({ host }));
	}
	env.push(env_);

	let output = buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases: { configure },
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

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		binaries: ["bash"],
		metadata,
	});
	return directory;
});
