import * as std from "../../tangram.ts";

export const metadata = {
	name: "libmd",
	version: "1.1.0",
};

export const source = async () => {
	const { name, version } = metadata;
	const url = `https://libbsd.freedesktop.org/releases/${name}-${version}.tar.xz`;
	const checksum =
		"sha256:1bd6aa42275313af3141c7cf2e5b964e8b1fd488025caf2f971f43b00776b332";
	return await std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const build = async () =>
	std.autotools.build({
		source: source(),
	});

export default build;
