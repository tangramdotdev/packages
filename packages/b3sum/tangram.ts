import { cargo } from "rust" with { path: "../rust" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/BLAKE3-team/BLAKE3",
	license: "CC0-1.0",
	name: "blake3",
	repository: "https://github.com/BLAKE3-team/BLAKE3",
	version: "1.8.2",
	provides: {
		binaries: ["b3sum"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6b51aefe515969785da02e87befafc7fdc7a065cd3458cf1141f29267749e81f";
	const owner = "BLAKE3-team";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
};

type Arg = {
	build?: string;
	cargo?: cargo.Arg;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: tg.Args<Arg>) => {
	const {
		build,
		host,
		cargo: cargoArgs = {},
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			manifestSubdir: "b3sum",
			sdk,
			source: source_ ?? source(),
		},
		cargoArgs,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
