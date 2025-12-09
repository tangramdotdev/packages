import * as std from "std" with { local: "./std" };
import * as bash from "bash" with { local: "./bash.tg.ts" };

export const metadata = {
	homepage: "https://www.iana.org/time-zones",
	name: "tzdb",
	license: "https://github.com/eggert/tz/blob/main/LICENSE",
	repository: "https://github.com/eggert/tz",
	version: "2025b",
	tag: "tzdb/2025b",
	provides: {
		binaries: ["zdump", "zic"],
		libraries: [{ name: "tz", dylib: false, staticlib: true }],
	},
};

export const source = async (): Promise<tg.Directory> => {
	const { version } = metadata;
	const checksum =
		"sha256:7e281b316b85e20c9a67289805aa2a2ee041b5a41ccf5d096af3386ba76cf9d5";
	const owner = "eggert";
	const repo = "tz";
	const tag = `${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			env: {
				CC: "cc",
				CFLAGS: tg.Mutation.suffix("-O2", " "),
			},
			phases: {
				configure: tg.Mutation.unset(),
				build: tg.Mutation.unset(),
				install: `make TOPDIR="$OUTPUT" install`,
			},
		},
		...args,
	);

	let output = await std.autotools.build(arg);

	// tzselect is a shell script, wrap it.
	const unwrapped = await output.get("usr/bin/tzselect").then(tg.File.expect);
	output = await tg.directory(output, {
		["usr/bin/tzselect"]: bash.wrapScript(unwrapped, arg.host),
	});

	// Add toplevel binary symlinks.
	output = await tg.directory(output, {
		bin: {
			tzselect: tg.symlink("../usr/bin/tzselect"),
			zdump: tg.symlink("../usr/bin/zdump"),
			zic: tg.symlink("../usr/sbin/zic"),
		},
		lib: tg.symlink("./usr/lib"),
	});

	return output;
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["--help"],
			snapshot: "usage",
		}),
	};
	return await std.assert.pkg(build, spec);
};
