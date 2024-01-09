import pcre2 from "tg:pcre2" with { path: "../pcre2" };
import * as rust from "tg:rust" with { path: "../rust" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "ripgrep",
	owner: "BurntSushi",
	repo: "ripgrep",
	version: "14.0.3",
};

export let source = tg.target(async () => {
	let { owner, repo, version } = metadata;
	let checksum =
		"sha256:f5794364ddfda1e0411ab6cad6dd63abe3a6b421d658d9fee017540ea4c31a0e";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag: version,
		version,
	});
});

type Arg = {
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	rust?: tg.MaybeNestedArray<rust.Arg>;
	source?: tg.Directory;
	host?: std.Triple.Arg;
};

export let ripgrep = tg.target(async (arg?: Arg) => {
	let {
		build,
		env: env_,
		host,
		rust: rustArgs = [],
		source: source_,
		...rest
	} = arg ?? {};

	let env = [pcre2(arg), env_];

	return rust.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			features: ["pcre2"],
			source: source_ ?? source(),
		},
		rustArgs,
	);
});

export default ripgrep;

export let test = tg.target(async () => {
	await tg.build(tg`
		echo "Checking that we can run ripgrep."
		${ripgrep()}/bin/rg --version
	`);

	// // On Linux, test cross-compiling.
	// let host = await std.Triple.host();
	// let os = tg.System.os(std.Triple.system(host));
	// if (os === "linux") {
	// 	// Determine the target triple with differing architecture from the host.
	// 	let hostArch = host.arch;
	// 	let targetArch: std.Triple.Arch =
	// 		hostArch === "x86_64" ? "aarch64" : "x86_64";
	// 	let target = std.triple({
	// 		arch: targetArch,
	// 		vendor: "unknown",
	// 		os: "linux",
	// 		environment: "gnu",
	// 	});

	// 	// Assert that we build a binary for the target.
	// 	let output = await ripgrep({ host: target });
	// 	tg.Directory.assert(output);
	// 	let bin = await output.get("bin/rg");
	// 	tg.File.assert(bin);
	// 	let metadata = await std.file.executableMetadata(bin);
	// 	tg.assert(metadata.format === "elf");
	// 	tg.assert(metadata.arch === targetArch);
	// }
	return true;
});
