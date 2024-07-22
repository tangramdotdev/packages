import pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import openssl from "tg:openssl" with { path: "../openssl" };
import { cargo } from "tg:rust" with { path: "../rust" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/ducaale/xh",
	license: "MIT",
	name: "xh",
	repository: "https://github.com/ducaale/xh",
	version: "0.22.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:32a6470ab705aba4c37fce9806202dcc0ed24f55e091e2f4bdf7583108a3da63";
	let owner = "ducaale";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

export type Arg = {
	build?: string;
	cargo?: cargo.Arg;
	env?: std.env.Arg;
	host?: string;
	nativeTls?: boolean;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		build: build_,
		cargo: cargoArg = {},
		env: env_,
		host: host_,
		nativeTls = true,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];

	let disableDefaultFeatures = false;
	let features = [];
	if (nativeTls) {
		disableDefaultFeatures = true;
		features.push("native-tls");
		if (std.triple.os(host) === "linux") {
			env.push(pkgconfig({ build, host: build }), openssl({ build, host }));
		}
	}

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			disableDefaultFeatures,
			env: std.env.arg(env),
			features,
			sdk,
			source: source_ ?? source(),
		},
		cargoArg,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["xh"],
		metadata,
	});
	return true;
});
