import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import guardedGettextPatch from "./bash-use-guarded-gettext-header.patch" with {
	type: "file",
};

export const metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.2.37",
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9599b22ecd1d5787ad7d3b7bf0c59f312b3396d1e281175dd1f8a4014da621ff";
	let source = await std.download.fromGnu({ name, version, checksum });
	source = await bootstrap.patch(source, guardedGettextPatch);
	return source;
});

export const build = tg.command(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_ = [],
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configureArgs = ["--without-bash-malloc", "--disable-nls"];

	// If the provided env has ncurses in the library path, use it instead of termcap.
	const envArg = await std.env.arg(env_);
	if (await providesNcurses(envArg)) {
		configureArgs.push("--with-curses");
	}

	const configure = {
		args: configureArgs,
	};
	const phases = { configure };

	const env: tg.Unresolved<std.Args<std.env.Arg>> = [env_];
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
		env: std.env.arg(env),
		phases,
		sdk,
		source: source_ ?? source(),
	});

	output = tg.directory(output, {
		"bin/sh": tg.symlink("bash"),
	});

	return output;
});

export default build;

const providesNcurses = async (env: std.env.Arg): Promise<boolean> => {
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

export const test = tg.command(async () => {
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
	return build({ host, sdk: false, env: sdk });
});
