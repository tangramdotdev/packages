// import * as std from "../tangram.tg.ts";
// import { buildCmakeComponent } from "./cmake.tg.ts";

// export let ninja = async (arg?: std.sdk.BuildEnvArg) => {
// 	let { env } = await std.sdk.buildEnv(arg);
// 	let configure = {
// 		args: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_C_FLAGS=$LDFLAGS"],
// 	};

// 	let source = std.download.fromMetadata(metadata);

// 	let result = buildCmakeComponent({
// 		...arg,
// 		phases: { configure },
// 		env,
// 		source,
// 	});

// 	return result;
// };

// export default ninja;

// export let source = () => {
// 	return std.download.fromMetadata(metadata);
// };

// export let metadata = {
// 	checksum:
// 		"sha256:31747ae633213f1eda3842686f83c2aa1412e0f5691d1c14dbbcc67fe7400cea",
// 	name: "ninja",
// 	owner: "ninja-build",
// 	tag: "v1.11.1",
// 	url: "github",
// 	version: "1.11.1",
// };
