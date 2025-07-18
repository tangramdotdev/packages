import pkgConfig from "pkg-config" with { local: "../pkg-config" };
import openssl from "openssl" with { local: "../openssl" };
import { cargo } from "rust" with { local: "../rust" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://github.com/ducaale/xh",
	license: "MIT",
	name: "xh",
	repository: "https://github.com/ducaale/xh",
	version: "0.23.0",
	provides: {
		binaries: ["xh"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:c44ca41b52b5857895d0118b44075d94c3c4a98b025ed3433652519a1ff967a0";
	const owner = "ducaale";
	const repo = name;
	const tag = `v${version}`;
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
	cargo?: cargo.Arg;
	env?: std.env.Arg;
	host?: string;
	nativeTls?: boolean;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		cargo: cargoArg = {},
		env: env_,
		host: host_,
		nativeTls = true,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const env: tg.Unresolved<Array<std.env.Arg>> = [env_];

	let disableDefaultFeatures = false;
	const features = [];
	if (nativeTls) {
		disableDefaultFeatures = true;
		features.push("native-tls");
		if (std.triple.os(host) === "linux") {
			env.push(pkgConfig({ build, host: build }), openssl({ build, host }));
		}
	}

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			disableDefaultFeatures,
			env: std.env.arg(...env),
			features,
			sdk,
			source: source_ ?? source(),
		},
		cargoArg,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
