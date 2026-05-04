import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import envRestorePatch from "./patch-bash-env-restore.patch" with { type: "file" };

export const metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.3",
	tag: "bash/5.3",
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
		"sha256:0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba";
	let source = await std.download.fromGnu({ name, version, checksum });
	source = await bootstrap.patch(source, envRestorePatch);
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

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configureArgs = ["--without-bash-malloc", "--disable-nls"];

	// If the provided env has ncurses in the library path, use it instead of termcap.
	const envArg = await std.env.arg(env_, { utils: false });
	if (await providesNcurses(envArg)) {
		configureArgs.push("--with-curses");
	}

	// DIAGNOSTIC: When built with bootstrap=true, cc.env will NOT inject a
	// toolchain, so the caller must supply one via env_ or sdk. Detect the
	// common regression where the caller passes utils-only into bash. Emit a
	// stack trace to identify the offending call site.
	if (bootstrap_) {
		let hasCompiler = false;
		for (const name of ["cc", "gcc", "clang", "c99"]) {
			try {
				await std.env.which({ env: envArg, name });
				hasCompiler = true;
				break;
			} catch (_) {
				// not found, try next.
			}
		}
		if (!hasCompiler && sdk === undefined) {
			const diag = new Error(
				"std.utils.bash.build invoked with bootstrap=true but env_ contains no C compiler and no sdk was provided. This will fail at configure time with 'no acceptable C compiler found'.",
			);
			console.error(diag.stack ?? diag.message);
			throw diag;
		}
	}

	const configure = {
		args: configureArgs,
	};
	const phases = { configure };

	const env: std.Args<std.env.Arg> = [];
	env.push(prerequisites(build));
	env.push({
		CFLAGS: tg.Mutation.prefix(
			"-Wno-implicit-function-declaration -std=gnu17",
			" ",
		),
	});

	let output: PromiseLike<tg.Directory> = autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		env: std.env.arg(env_, ...env, { utils: false }),
		phases,
		processName: metadata.name,
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
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);

	const bashDir = await build({ host, bootstrap: true, env: sdk });
	// Inspect dependencies
	const bashFile = await bashDir.get("bin/bash").then(tg.File.expect);
	const deps = await bashFile.dependencies;
	console.log("Bash file dependencies:");
	const depsEntries = Object.entries(deps);
	for (const [key, value] of depsEntries) {
		console.log(`  ${key}: ${value}`);
	}
	const totalDeps = depsEntries.length;
	console.log(`Total dependencies: ${totalDeps}`);
	tg.assert(totalDeps > 0, "expected depdendencies to be set");
	return bashDir;
};
