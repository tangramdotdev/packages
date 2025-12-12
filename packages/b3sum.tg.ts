import { cargo } from "rust" with { local: "./rust" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/BLAKE3-team/BLAKE3",
	license: "CC0-1.0",
	name: "b3sum",
	repository: "https://github.com/BLAKE3-team/BLAKE3",
	version: "1.8.2",
	tag: "b3sum/1.8.2",
	provides: {
		binaries: ["b3sum"],
	},
};

export const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:6b51aefe515969785da02e87befafc7fdc7a065cd3458cf1141f29267749e81f";
	const owner = "BLAKE3-team";
	const repo = "blake3";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
};

export type Arg = cargo.Arg;

export const build = (...args: std.Args<Arg>) =>
	cargo.build({ source: source(), manifestSubdir: "b3sum" }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
