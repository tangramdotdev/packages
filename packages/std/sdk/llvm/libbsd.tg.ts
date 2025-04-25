import * as std from "../../tangram.ts";
import libmd from "./libmd.tg.ts";

export const metadata = {
	name: "libbsd",
	version: "0.12.2",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const url = `https://libbsd.freedesktop.org/releases/${name}-${version}.tar.xz`;
	const checksum =
		"sha256:b88cc9163d0c652aaf39a99991d974ddba1c3a9711db8f1b5838af2a14731014";
	return await std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export const build = tg.command(async () =>
	std.autotools.build({
		env: libmd(),
		source: source(),
	}),
);

export default build;
