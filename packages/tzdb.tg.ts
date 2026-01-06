import * as std from "std" with { local: "./std" };
import * as bash from "bash" with { local: "./bash.tg.ts" };

export const metadata = {
	homepage: "https://www.iana.org/time-zones",
	name: "tzdb",
	license: "https://github.com/eggert/tz/blob/main/LICENSE",
	repository: "https://github.com/eggert/tz",
	version: "2025c",
	tag: "tzdb/2025c",
	provides: {
		binaries: ["zdump", "zic"],
		libraries: [
			{ name: "tz", dylib: false, staticlib: true, pkgConfigName: false },
		],
	},
};

export const source = async (): Promise<tg.Directory> => {
	const { version } = metadata;
	const checksum =
		"sha256:d970fb6753529583226fb1bb9df6237e5e968ea7d70a8bd0df2f3394c86f7ac4";
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
			buildInTree: true,
			env: {
				CC: "cc",
			},
			phases: {
				configure: tg.Mutation.unset(),
				build: tg.Mutation.unset(),
				install: tg`make TOPDIR="${tg.output}" install`,
			},
		},
		...args,
	);

	// On macOS, disable gettext to avoid libintl dependency.
	const os = std.triple.os(arg.host);
	if (os === "darwin") {
		arg.env = await std.env.arg(arg.env, {
			CFLAGS: tg.Mutation.suffix("-DHAVE_GETTEXT=0", " "),
		});
	}

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
