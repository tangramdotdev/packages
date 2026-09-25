import * as std from "../tangram.ts";

export const metadata = {
	name: "m4",
	version: "1.4.21",
	tag: "m4/1.4.21",
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:f25c6ab51548a73a75558742fb031e0625d6485fe5f9155949d6486a2408ab66";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(...args: tg.Args<Arg>) {
	const {
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await tg.Args.apply<Arg, tg.ValueOrMaybeMutationMap<Arg>, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {},
	});

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.compose(env_ ?? null);

	const output = std.utils.autotoolsInternal({
		build: build ?? null,
		host: host ?? null,
		env,
		fortifySource: 2,
		phases: { configure },
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
		source: source_ ?? source(),
	});

	return output;
}

export default build;


export async function test() {
	return std.assert.pkg(build, {
		binaries: [std.assert.displaysVersion("m4", metadata.version)],
	});
}

/** The tests in this module, grouped by tier. */
export const tests = {
	sdk: [test],
};
