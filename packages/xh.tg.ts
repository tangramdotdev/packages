import openssl from "openssl" with { local: "./openssl.tg.ts" };
import { cargo } from "rust" with { local: "./rust" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/ducaale/xh",
	license: "MIT",
	name: "xh",
	repository: "https://github.com/ducaale/xh",
	version: "0.25.0",
	tag: "xh/0.25.0",
	provides: {
		binaries: ["xh"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6145f48cbefbb2bd1aa97ebcc8528d15ada1303e6e80fdd6a4637014f0f1df1c";
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

export type Arg = Omit<cargo.Arg, "deps"> & {
	nativeTls?: boolean;
};

export const build = async (...args: std.Args<Arg>) => {
	// Extract custom options first.
	type CustomOptions = { nativeTls?: boolean; host?: string };
	const customOptions = await std.args.apply<CustomOptions, CustomOptions>({
		args: args as std.Args<CustomOptions>,
		map: async (arg) => arg,
		reduce: {},
	});
	const nativeTls = customOptions.nativeTls ?? true;

	let disableDefaultFeatures = false;
	const features: Array<string> = [];
	// Only include openssl deps if nativeTls is enabled.
	const deps = nativeTls
		? await std.deps({
				openssl: {
					build: openssl,
					kind: "runtime",
					when: (ctx) => std.triple.os(ctx.host) === "linux",
				},
			})
		: undefined;

	if (nativeTls) {
		disableDefaultFeatures = true;
		features.push("native-tls");
	}

	return cargo.build(
		{
			source: source(),
			...(deps !== undefined && { deps }),
			disableDefaultFeatures,
			features,
		},
		...args,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
