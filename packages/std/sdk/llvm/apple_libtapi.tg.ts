import * as std from "../../tangram.tg.ts";
import * as bootstrap from "../../bootstrap.tg.ts";
import * as dependencies from "../dependencies.tg.ts";
import { $ } from "../../tangram.tg.ts";
import cmake from "../cmake.tg.ts";
import ninja from "../ninja.tg.ts";

export let source = tg.target(async () => {
	let url = `https://github.com/tpoechtrager/apple-libtapi/archive/refs/heads/1300.6.5.zip`;
	let checksum =
		"sha256:22615934da56e710a63a44b7bda55d619e1c23a3ee2331661592661acf3b8a88";
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export let build = tg.target(async () => {
	let host = await std.triple.host();

	let llvmSdk = std.sdk({ host, toolchain: "llvm" });
	let cmakeArtifact = cmake({ host });
	let ninjaArtifact = ninja({ host });
	let python = dependencies.python.build({
		host,
		sdk: bootstrap.sdk.arg(host),
	});
	let env = std.env.arg(llvmSdk, cmakeArtifact, ninjaArtifact, python);

	return await $`
		cp -R ${source()}/* .
		chmod -R u+w .

		INSTALLPREFIX=$OUTPUT ./build.sh
		./install.sh
	`
		.env(env)
		.then(tg.Directory.expect);
});

export default build;
