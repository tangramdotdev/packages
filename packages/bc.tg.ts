import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/gavinhoward/bc",
	name: "bc",
	license: "BSD-2-Clause",
	repository: "https://github.com/gavinhoward/bc",
	version: "7.1.0",
	tag: "bc/7.1.0",
	provides: {
		binaries: ["bc", "dc"],
	},
};

async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:1f13663ba0f2435b684321714a4d0b9fff32bb951fc78dc7424cd69bba5c0d3a";
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
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
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
	const env = std.env.arg(arg.env ?? null, {
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
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
