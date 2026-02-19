import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/gavinhoward/bc",
	name: "bc",
	license: "BSD-2-Clause",
	repository: "https://github.com/gavinhoward/bc",
	version: "7.0.3",
	tag: "bc/7.0.3",
	provides: {
		binaries: ["bc", "dc"],
	},
};

const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:91eb74caed0ee6655b669711a4f350c25579778694df248e28363318e03c7fc4";
	const tag = version;
	const owner = "gavinhoward";
	const repo = name;
	return std.download
		.fromGithub({
			checksum,
			compression: "xz",
			owner,
			repo,
			tag,
			source: "release",
			version,
		})
		.then(tg.Directory.expect);
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			buildInTree: true,
			opt: "3",
			env: { CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
			phases: {
				configure: { args: ["--disable-nls", "--opt=3"] },
			},
		},
		...args,
	);
	// On Darwin, add _DARWIN_C_SOURCE define.
	const ccCommand =
		std.triple.os(arg.build) === "darwin" ? "cc -D_DARWIN_C_SOURCE" : "cc";
	const env = std.env.arg(arg.env, {
		CC: tg.Mutation.setIfUnset(ccCommand),
	});
	let output = await std.autotools.build({ ...arg, env });
	// bc's safe-install.sh uses `cat` to copy files, which strips xattrs.
	// Re-wrap the binaries to restore dependency metadata from the manifest.
	for (const bin of ["bc", "dc"]) {
		const file = await output.get(`bin/${bin}`).then(tg.File.expect);
		output = await tg.directory(output, {
			[`bin/${bin}`]: std.wrap(file),
		});
	}
	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
