import * as std from "../../tangram.tg.ts";
import libmd from "./libmd.tg.ts";

export let metadata = {
	name: "libbsd",
	version: "0.12.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let url = `https://libbsd.freedesktop.org/releases/${name}-${version}.tar.xz`;
	let checksum =
		"sha256:b88cc9163d0c652aaf39a99991d974ddba1c3a9711db8f1b5838af2a14731014";
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export let build = tg.target(async () =>
	std.autotools.build({
		env: libmd(),
		source: source(),
	}),
);

export default build;
