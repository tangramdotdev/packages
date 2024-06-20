import * as cmake from "tg:cmake" with { path: "../cmake" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://ziglang.org",
	license: "",
	name: "zig",
	repository: "https://github.com/ziglang/zig",
	version: "0.13.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:cd446c084b5da7bc42e8ad9b4e1c910a957f2bf3f82bcc02888102cd0827c139";
	let owner = "ziglang";
	let repo = name;
	let tag = version;
	let url = `https://github.com/${owner}/${repo}/releases/download/${tag}/zig-bootstrap-${version}.tar.xz`;
	return std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let sourceDir = source_ ?? source();

	// // Define phases.
	// let buildPhase = `./bootstrap.sh`;
	// let install = {
	// 	command: `cp -r ./* $OUTPUT`,
	// 	args: tg.Mutation.unset(),
	// };
	// let phases = {
	// 	configure: tg.Mutation.unset(),
	// 	build: buildPhase,
	// 	install,
	// };

	let env = std.env.arg(env_);

	return std.autotools.build({
		...std.triple.rotate({ build, host }),
		debug: true,
		env,
		// phases,
		sdk,
		source: sourceDir,
	});
});

export default build;

export let bootstrap = tg.target(async () => {
	let host = await std.triple.host();
	return await $`cp -R ${source()}/. . && ./build ${host} baseline`
		.env(std.sdk(), cmake.cmake())
		.checksum("unsafe");
});
