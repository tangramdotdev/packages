import { cargo } from "rust" with { local: "./rust" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://rust-lang.github.io/rust-bindgen/",
	license: "BSD-3-Clause",
	name: "bindgen",
	repository: "https://github.com/rust-lang/rust-bindgen",
	version: "0.72.0",
	tag: "bindgen/0.72.0",
	provides: {
		binaries: ["bindgen"],
	},
};

export const source = () => {
	const { version } = metadata;
	const checksum = "sha256:any";
	const owner = "rust-lang";
	const repo = "rust-bindgen";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: `v${version}`,
	});
};

export type Arg = cargo.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const llvmSdk = std.sdk({ toolchain: "llvm" });
	return cargo.build(
		{
			source: source(),
			manifestSubdir: "bindgen-cli",
			useCargoVendor: true,
			env: std.env.arg(llvmSdk, {
				LIBCLANG_PATH: tg`${llvmSdk}/lib`,
			}),
		},
		...args,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
