import { libclang } from "llvm" with { source: "./llvm" };
import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.nushell.sh/",
	license: "MIT",
	name: "nushell",
	repository: "https://github.com/nushell/nushell",
	version: "0.116.1",
	tag: "nushell/0.116.1",
	provides: {
		binaries: ["nu"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:0cca0c5bc9d9eb608dee00c75b6b511917df6e66c784b034468bab2ff0fbb9b4";
	const owner = name;
	const repo = name;
	const tag = version;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
}

export type Arg = cargo.Arg;

export async function build(...args: tg.Args<Arg>) {
	const arg = await cargo.arg({ source: source() }, ...args);
	// On macOS, the `libproc` dependency generates its bindings with `bindgen`, which locates libclang through `LIBCLANG_PATH`.
	const env =
		std.triple.os(arg.host) === "darwin"
			? { LIBCLANG_PATH: tg`${await libclang({ host: arg.host })}/lib` }
			: undefined;
	return cargo.build(arg, std.args.optional("env", env));
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
