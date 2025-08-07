import * as go from "go" with { local: "../go" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://github.com/nats-io/nats-server",
	license: "Apache-2.0",
	name: "nats-server",
	repository: "https://github.com/nats-io/nats-server",
	version: "2.11.6",
	provides: {
		binaries: ["nats-server"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const owner = "nats-io";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:01eab5565268c280b322c8601932edaf41f3a2c688f119ecad90ffa47d55f015";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		source: "tag",
	});
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	go?: go.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		go: goArg = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return go.build(
		{
			...(await std.triple.rotate({ build, host })),
			cgo: false,
			env,
			sdk,
			source: source_ ?? source(),
		},
		goArg,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};

export const llvm = () => build({ sdk: { toolchain: "llvm" } });
export const crossGcc = () =>
	build({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
	});
export const crossLlvm = () =>
	build({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
		sdk: { toolchain: "llvm" },
	});
