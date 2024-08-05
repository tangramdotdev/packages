import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.2.32",
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:d3ef80d2b67d8cbbe4d3265c63a72c46f9b278ead6e0e06d61801b58f23f50b5";
	return std.download.fromGnu({ name, version, checksum });
});

export let build = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_ = [],
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configureArgs = ["--without-bash-malloc"];

	// If the provided env has ncurses in the library path, use it instead of termcap.
	let envArg = await std.env.arg(env_);
	if (await providesNcurses(envArg)) {
		configureArgs.push("--with-curses");
	}

	let configure = {
		args: configureArgs,
	};
	let phases = { configure };

	let env: tg.Unresolved<std.Args<std.env.Arg>> = [env_];
	env.push(prerequisites(build));
	env.push(bootstrap.shell(host));
	env.push({
		CFLAGS: tg.Mutation.prefix("-Wno-implicit-function-declaration", " "),
	});

	let output = buildUtil({
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
	let sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
