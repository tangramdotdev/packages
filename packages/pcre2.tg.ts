import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/PCRE2Project/pcre2",
	name: "pcre2",
	repository: "https://github.com/PCRE2Project/pcre2",
	license: "https://github.com/PCRE2Project/pcre2/blob/master/LICENCE",
	version: "10.49",
	tag: "pcre2/10.49",
	provides: {
		libraries: ["pcre2-8"],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:929f0b20e62879252a15886b06c89f1edef61a363cbd5826fb041080a5e557ae";
	const owner = "PCRE2Project";
	const repo = name;
	const tag = `pcre2-${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		source: "release",
		repo,
		tag,
		version,
	});
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking", "--enable-fast-install=no"],
				},
			},
		},
		...args,
	);
	let phases = arg.phases ?? null;
	if (arg.build !== arg.host) {
		phases = await std.phases.arg(phases, {
			configure: {
				args: [`--build=${arg.build}`, `--host=${arg.host}`],
			},
		});
	}
	return std.autotools.build({ ...arg, phases });
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
