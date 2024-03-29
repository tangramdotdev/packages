import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import ninja from "./ninja.tg.ts";

export let metadata = {
	name: "cmake",
	version: "3.29.0",
};

export let source = tg.target(() => {
	let { version } = metadata;
	let checksum =
		"sha256:a0669630aae7baa4a8228048bf30b622f9e9fd8ee8cedb941754e9e38686c778";
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

export type Arg = std.sdk.BuildEnvArg & {
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

	let prepare = tg`
		cp -rT ${sourceDir} $PWD
		chmod -R u+w .`;

	let configure = {
		command: `./bootstrap`,
		args: [
			`--parallel=$(nproc)`,
			`--`,
			`-DCMAKE_USE_OPENSSL=OFF`,
			`-DBUILD_SHARED_LIBS=OFF`,
		],
	};

	let deps = [
		dependencies.env({
			...rest,
			env: std.sdk({ host: build, bootstrapMode: rest.bootstrapMode }),
			host: build,
		}),
	];
	let env = [
		...deps,
		{
			LDFLAGS: tg.Mutation.templatePrepend("-static", " "),
			TANGRAM_LINKER_PASSTHROUGH: "1",
		},
		env_,
	];

	let result = std.autotools.build({
		...rest,
		...std.triple.rotate({ build, host }),
		env,
		hardeningCFlags: false,
		phases: { prepare, configure },
		source: sourceDir,
	});

	return result;
});

export default cmake;

export type BuildArg = std.autotools.Arg & {
	useNinja?: boolean;
};

/** Wrapper for `std.autotools.build` that invokes `cmake` to generate the build system. */
export let build = tg.target(
	async (arg: BuildArg, autotools: tg.MaybeNestedArray<std.autotools.Arg>) => {
		let {
			env: env_,
			host: host_,
			phases: phases_,
			prefixArg: prefixArg_,
			target: target_,
			useNinja = true,
			...rest
		} = arg ?? {};
		let host = host_ ?? (await std.triple.host());
		let target = target_ ?? host;

		// Set up env vars to pass through the include and library paths.
		let cmakeEnv = `
			export CMAKE_INCLUDE_PATH="$(echo $CPATH | tr ':' ' ')"
			export CMAKE_LIBRARY_PATH="$(echo $LIBRARY_PATH | tr ':' ' ')"
		`;

		// Set up build phases.
		let buildCommand = `cmake --build .`;
		let generator = useNinja ? ` -G Ninja` : ``;
		let configureCommand = tg`cmake -S ${arg.source}${generator}`;
		let installCommand = `cmake --build . --target install`;
		let prefixArg = prefixArg_ ?? `-DCMAKE_INSTALL_PREFIX=`;

		// Obtain a statically linked `cmake` binary and add it to the env.
		let bootstrapHost = bootstrap.toolchainTriple(host);
		let dependencies = [
			cmake({
				host: bootstrapHost,
				bootstrapMode: true,
				env: std.sdk({ host: bootstrapHost, bootstrapMode: true }),
			}),
		];
		if (useNinja) {
			dependencies.push(ninja({ host }));
		}
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
	let detectedHost = await std.triple.host();
	let host = bootstrap.toolchainTriple(detectedHost);
	let directory = cmake({ host, sdk: { bootstrapMode: true } });
	await std.assert.pkg({
		directory,
		binaries: ["cmake"],
		metadata,
	});
	return directory;
});
