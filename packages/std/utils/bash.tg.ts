import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import guardedGettextPatch from "./bash-use-guarded-gettext-header.patch" with {
	type: "file",
};
import envRestorePatch from "./patch-bash-env-restore.patch" with {
	type: "file",
};

export const metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.2.37",
	tag: "bash/5.2.37",
};

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9599b22ecd1d5787ad7d3b7bf0c59f312b3396d1e281175dd1f8a4014da621ff";
	let source = await std.download.fromGnu({ name, version, checksum });
	source = await bootstrap.patch(source, guardedGettextPatch, envRestorePatch);
	return source;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configureArgs = ["--without-bash-malloc", "--disable-nls"];

	// If the provided env has ncurses in the library path, use it instead of termcap.
	const envArg = await std.env.arg(env_, { utils: false });
	if (await providesNcurses(envArg)) {
		configureArgs.push("--with-curses");
	}

	const configure = {
		args: configureArgs,
	};
	const phases = { configure };

	const env: Array<tg.Unresolved<std.env.Arg>> = [];
	env.push(prerequisites(build));
	env.push(bootstrap.shell(host));
	env.push({
		CFLAGS: tg.Mutation.prefix(
			"-Wno-implicit-function-declaration -std=gnu17",
			" ",
		),
	});

	let output = autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env: std.env.arg(...env, env_, { utils: false }),
		phases,
		sdk,
		source: source_ ?? source(),
	});

	output = tg.directory(output, {
		"bin/sh": tg.symlink("bash"),
	});

	return output;
};

export default build;

const providesNcurses = async (env: std.env.EnvObject): Promise<boolean> => {
	for await (const [_, dir] of std.env.dirsInVar({
		env,
		key: "LIBRARY_PATH",
	})) {
		for await (const [name, _] of dir) {
			if (name.includes("libncurses")) {
				return true;
			}
		}
	}
	return false;
};

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	// FIXME - build assert args properly!
	// await std.assert.pkg({
	// 	buildFn: build,
	// 	binaries: ["bash"],
	// 	bootstrapMode: true,
	// 	env: sdk,
	// })
	// return true;
	return build({ host, bootstrap: true, env: sdk });
};
