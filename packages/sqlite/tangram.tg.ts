import readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "sqlite",
	version: "3.44.2",
};

export let source = tg.target(async () => {
	let { name } = metadata;
	let checksum =
		"sha256:1c6719a148bc41cf0f2bbbe3926d7ce3f5ca09d878f1246fcc20767b175bb407";
	let unpackFormat = ".tar.gz" as const;
	let pkgName = `${name}-autoconf-3440200`;
	let url = `https://www.sqlite.org/2023/${pkgName}${unpackFormat}`;
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
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let sqlite = tg.target((arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default sqlite;

export let test = tg.target(async () => {
	let sqliteArtifact = sqlite();
	await std.build(tg`
		echo "Checking that we can run sqlite3." | tee $OUTPUT
		${sqliteArtifact}/bin/sqlite3 -version | tee -a $OUTPUT
	`);
	return true;
});
