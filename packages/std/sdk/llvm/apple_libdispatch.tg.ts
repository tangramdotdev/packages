import * as std from "../../tangram.ts";
import libbsd from "./libbsd.tg.ts";
import * as cmake from "../cmake.tg.ts";

export const source = tg.command(async () => {
	const url = `https://github.com/tpoechtrager/apple-libdispatch/archive/ee39300b12a77efd3f2f020e009e42d557adbb29.zip`;
	const checksum =
		"sha256:d6ab90b7e8cbf30725be83491bc85ff708daea130bafcac94381b0a2de958b14";
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export const build = tg.command(async () => {
	const configure = {
		args: [
			"-DCMAKE_INSTALL_LIBDIR=lib",
			"-DCMAKE_C_FLAGS=-Wno-error=unused-command-line-argument",
			"-DCMAKE_CXX_FLAGS=-Wno-error=unused-command-line-argument",
		],
	};

	const phases = { configure };

	return await cmake.build({
		env: libbsd(),
		phases,
		source: source(),
		sdk: { toolchain: "llvm" },
	});
});

export default build;
