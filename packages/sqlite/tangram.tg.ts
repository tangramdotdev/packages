import readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "sqlite",
	version: "3.45.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:72887d57a1d8f89f52be38ef84a6353ce8c3ed55ada7864eb944abd9a495e436";
	let unpackFormat = ".tar.gz" as const;

	let produceVersion = (version: string) => {
		let [major, minor, patch] = version.split(".");
		tg.assert(major);
		tg.assert(minor);
		tg.assert(patch);
		return `${major}${minor.padEnd(3, '0')}${patch.padEnd(3, '0')}`;
	};

	let pkgName = `${name}-autoconf-${produceVersion(version)}`;
	let url = `https://www.sqlite.org/2024/${pkgName}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);
	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let sqlite = tg.target((arg?: Arg) => {
	let { autotools = [], build, env: env_, host, source: source_, ...rest } = arg ?? {};

	let dependencies = [
		readline(arg),
		zlib(arg),
	];
	let env = [...dependencies, env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default sqlite;

export let test = tg.target(async () => {
	let directory = sqlite();
	await std.assert.pkg({
		directory,
		binaries: ["sqlite3"],
		metadata
	});
	return directory;
});
