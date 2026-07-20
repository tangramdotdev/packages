import * as std from "../../tangram.ts";

export const metadata = {
	name: "libmd",
	version: "1.2.0",
	tag: "libmd/1.2.0",
};

export async function source() {
	const { name, version } = metadata;
	const url = `https://libbsd.freedesktop.org/releases/${name}-${version}.tar.xz`;
	const checksum =
		"sha256:ac15ffb8430502fbaccdec66c5a82ee0eab0b0f36220df56710feadfeb13d0a0";
	return await std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export async function build() {
	return std.autotools.build({
		source: source(),
	});
}

export default build;
