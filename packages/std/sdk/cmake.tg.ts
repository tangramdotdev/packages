// import * as std from "../tangram.tg.ts";
// import ncurses from "./ncurses.tg.ts";

// export let metadata = {
// 	name: "cmake",
// 	version: "3.27.4",
// };

// export let source = tg.target(() => {
// 	let { version } = metadata;
// 	let checksum =
// 		"sha256:0a905ca8635ca81aa152e123bdde7e54cbe764fdd9a70d62af44cad8b92967af";
// 	let owner = "Kitware";
// 	let repo = "CMake";
// 	let tag = `v${version}`;
// 	return std.download.fromGithub({ checksum, owner, repo, tag, release: true });
// });

// export let cmake = tg.target(async (arg?: std.sdk.BuildEnvArg) => {
// 	let { env } = await std.sdk.buildEnv(arg);
// 	let source_ = source();

// 	let configure = {
// 		command: await tg`${source_}/bootstrap`,
// 		args: [`--parallel=$(nproc)`, `--`, `-DCMAKE_USE_OPENSSL=OFF`],
// 	};

// 	let result = std.phases.autotools.build({
// 		...arg,
// 		phases: { configure },
// 		// env,
// 		env: [
// 			env,
// 			{
// 				LDFLAGS: "-static",
// 				TANGRAM_LINKER_PASSTHROUGH: "1",
// 			},
// 		],
// 		parallel: true,
// 		prefixArg: `-DCMAKE_INSTALL_PREFIX=`,
// 		source: source_,
// 	});

// 	return result;
// });

// export default cmake;

// /* Special case of buildComponent that uses cmake instead of configure/make/make install. */
// export let buildCmakeComponent = tg.target(
// 	async (arg: std.phases.autotools.Arg) => {
// 		return tg.unimplemented();
// 		// let resolved = await tg.resolve(arg);
// 		// let jobs = resolved.parallel ? "$(nproc)" : 1;
// 		// let buildCommand = arg.buildCommand ?? `cmake --build . -j ${jobs}`;
// 		// let configureCommand = arg.configureCommand ?? tg`cmake -S ${resolved.source}`;
// 		// // let configureArgs = [
// 		// // 	`-DCMAKE_C_FLAGS="$CFLAGS -std=c17"`,
// 		// // 	`-DCMAKE_CXX_FLAGS="$CFLAGS -std=c++20"`,
// 		// // 	...(resolved.configureArgs ?? []),
// 		// // ];
// 		// let configureArgs = resolved.configureArgs ?? [];

// 		// let installCommand =
// 		// 	resolved.installCommand ?? `cmake --build . --target install`;
// 		// let prefix = resolved.prefix ?? tg`-DCMAKE_INSTALL_PREFIX=$OUTPUT`;

// 		// let result = std.phases.autotools.build({
// 		// 	...arg,
// 		// 	buildCommand,
// 		// 	configureArgs,
// 		// 	configureCommand,
// 		// 	installCommand,
// 		// 	prefix,
// 		// 	source: resolved.source,
// 		// });
// 		// return result;
// 	},
// );
