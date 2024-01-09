// import { type Arg, buildComponent, configure } from "./run.tg.ts";
// import { linkerFlags } from "./libc.tg.ts";
// import ncurses from "./ncurses.tg.ts";
// import * as std from "tangram:../std";

// export let libedit = async (arg?: Arg) => {
// 	let { build, buildToolchain } = await configure(arg);
// 	let host = build;

// 	let source = std.download.fromMetadata(metadata);

// 	let buildLinkerFlags = linkerFlags({
// 		host,
// 		toolchain: buildToolchain,
// 	});
// 	let ncursesArtifact = ncurses(arg);
// 	let env = {
// 		CPPFLAGS: tg`-I${ncursesArtifact}/include/ncurses`,
// 		LDFLAGS: tg`${buildLinkerFlags} -s`,
// 	};

// 	return buildComponent({
// 		buildToolchain,
// 		dependencies: [ncursesArtifact],
// 		env,
// 		host,
// 		staticBuild: true,
// 		source,
// 	});
// };

// export default libedit;

// export let source = () => {
// 	return std.download.fromMetadata(metadata);
// }

// let metadata = {
// 	checksum:
// 		"sha256:f0925a5adf4b1bf116ee19766b7daa766917aec198747943b1c4edf67a4be2bb",
// 	name: "libedit",
// 	unwrap: true,
// 	url: "https://www.thrysoee.dk/editline",
// 	version: "20221030-3.1",
// };
