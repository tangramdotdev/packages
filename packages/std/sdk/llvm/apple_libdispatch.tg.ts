import * as std from "../../tangram.ts";
import libbsd from "./libbsd.tg.ts";
import * as cmake from "../cmake.tg.ts";

export async function source() {
	const url = `https://github.com/tpoechtrager/apple-libdispatch/archive/323b9b4e0ca05d6c56a0c2f2d7d8d47363e612b7.zip`;
	const checksum =
		"sha256:3a90136264ca82ca86fd5dd04dc23d969c6594d9764ecbbe7b6b88ba50641d8d";
	return await std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export async function build() {
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
}

export default build;
