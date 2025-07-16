import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as bash from "bash" with { local: "../bash" };

export const metadata = {
	homepage: "https://www.iana.org/time-zones",
	name: "tzdb",
	license: "https://github.com/eggert/tz/blob/main/LICENSE",
	repository: "https://github.com/eggert/tz",
	version: "2025b",
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

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build,
		env: env_,
		host,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceDir = source_ ?? source();

	const env = std.env.arg(
		std.sdk(std.triple.rotate({ build, host })),
		{
			CFLAGS: tg.Mutation.suffix("-O2", " "),
		},
		env_,
	);

	let output = await $`
		set -x
		cp -R ${sourceDir}/. .
		make TOPDIR=$OUTPUT install
		`
		.env(env)
		.then(tg.Directory.expect);

	// tzselect is a shell script, wrap it.
	const unwrapped = await output.get("usr/bin/tzselect").then(tg.File.expect);
	output = await tg.directory(output, {
		["usr/bin/tzselect"]: bash.wrapScript(unwrapped, host),
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
	const hasUsage = (name: string) => {
		return {
			name,
			testArgs: ["--help"],
			testPredicate: (stdout: string) => stdout.toLowerCase().includes("usage"),
		};
	};
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: metadata.provides.binaries.map(hasUsage),
	};
	return await std.assert.pkg(build, spec);
};
