import * as std from "tg:std" with { path: "../std" };
import bzip2 from "tg:bzip2" with { path: "../bzip2" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import openssl from "tg:openssl" with { path: "../openssl" };
import xz from "tg:xz" with { path: "../xz" };

export let metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "3.29.2",
};

export let source = tg.target(() => {
	let { version } = metadata;
	let checksum =
		"sha256:36db4b6926aab741ba6e4b2ea2d99c9193222132308b4dc824d4123cb730352e";
	let owner = "Kitware";
	let repo = "CMake";
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		release: true,
		version,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

/** Build `cmake`. */
export let cmake = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let sourceDir = source_ ?? source();

	let opensslDir = openssl({ ...rest, build, env: env_, host });

	let configure = {
		command: `./bootstrap`,
		args: [`--parallel=$(nproc)`, `--`, tg`-DOPENSSL_ROOT_DIR=${opensslDir}`],
	};

	let deps = [
		bzip2({ ...rest, build, env: env_, host }),
		pkgconfig({ ...rest, build, env: env_, host }),
		opensslDir,
		xz({ ...rest, build, env: env_, host }),
	];
	let env = [...deps, env_];

	let result = std.autotools.build({
		...rest,
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases: { configure },
		source: sourceDir,
	});

	return result;
});

export default cmake;

export type BuildArg = std.autotools.Arg;

/** Wrapper for `std.autotools.build` that invokes `cmake` to generate the build system. */
export let build = tg.target(
	async (arg: BuildArg, autotools: tg.MaybeNestedArray<std.autotools.Arg>) => {
		let {
			env: env_,
			host: host_,
			phases: phases_,
			prefixArg: prefixArg_,
			target: target_,
			...rest
		} = arg ?? {};
		let host = host_ ?? (await std.triple.host());
		let target = target_ ?? host;

		// Set up env vars to pass through the include and library paths.
		let cmakeEnv = `
			export CMAKE_INCLUDE_PATH="$CPATH"
			export CMAKE_LIBRARY_PATH="$LIBRARY_PATH"
		`;

		// Set up build phases.
		let buildCommand = `cmake --build .`;
		let configureCommand = tg`cmake -S ${arg.source}`;
		let installCommand = `cmake --build . --target install`;
		let prefixArg = prefixArg_ ?? `-DCMAKE_INSTALL_PREFIX=`;

		let dependencies = [cmake({ host })];
		let env = [...dependencies, env_];

		let cmakePhases = {
			cmakeEnv,
			configure: {
				command: configureCommand,
			},
			build: {
				command: buildCommand,
			},
			install: {
				command: installCommand,
			},
		};

		let result = std.autotools.build(
			{
				...rest,
				env,
				host,
				phases: {
					phases: cmakePhases,
					order: ["cmakeEnv", ...std.phases.defaultOrder()],
				},
				prefixArg,
				target,
			},
			{ phases: phases_ },
			autotools,
		);
		return result;
	},
);

export let test = tg.target(async () => {
	let directory = cmake();
	await std.assert.pkg({
		directory,
		binaries: ["cmake"],
		metadata,
	});
	return directory;
});
