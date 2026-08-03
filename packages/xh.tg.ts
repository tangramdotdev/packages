import openssl from "openssl" with { source: "./openssl.tg.ts" };
import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/ducaale/xh",
	license: "MIT",
	name: "xh",
	repository: "https://github.com/ducaale/xh",
	version: "0.26.1",
	tag: "xh/0.26.1",
	provides: {
		binaries: ["xh"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:6c4822374d3b9bacfc50719ffb5653a32fd84344e50fd88b499ed8fc9e52198b";
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
}

export type Arg = Omit<cargo.Arg, "deps"> & {
	nativeTls?: boolean;
};

export async function build(...args: tg.Args<Arg>) {
	// Extract custom options first.
	type CustomOptions = { nativeTls?: boolean; host?: string };
	const customOptions = await tg.Args.apply<
		CustomOptions,
		tg.ValueOrMaybeMutationMap<CustomOptions>,
		CustomOptions
	>({
		args: args as tg.Args<CustomOptions>,
		map: async (arg) => arg,
		reduce: {},
	});
	const nativeTls = customOptions.nativeTls ?? true;

	let disableDefaultFeatures = false;
	const features: Array<string> = [];
	// Only include openssl deps if nativeTls is enabled.
	const deps = nativeTls
		? std.deps({
				openssl: {
					build: openssl,
					kind: "runtime",
					when: { hostOs: "linux" },
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
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
