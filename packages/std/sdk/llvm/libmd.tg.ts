import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "libmd",
	version: "1.1.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let url = `https://libbsd.freedesktop.org/releases/${name}-${version}.tar.xz`;
	let checksum =
		"sha256:1bd6aa42275313af3141c7cf2e5b964e8b1fd488025caf2f971f43b00776b332";
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export let build = tg.target(async () =>
	std.autotools.build({
		source: source(),
	}),
);

export default build;
