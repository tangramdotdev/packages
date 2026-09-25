import * as std from "../tangram.ts";
import { autotoolsInternal } from "../utils.tg.ts";
import { sdk } from "./sdk.tg.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/make/",
	license: "GPLv3",
	name: "make",
	repository: "https://savannah.gnu.org/projects/make/",
	version: "4.4.1",
	tag: "make/4.4.1",
	provides: {
		binaries: ["make"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3";
	return std.download.fromGnu({ name, version, checksum });
}

export type Arg = {
	host?: string | null;
	embedWrapper?: boolean;
};

export async function build(...args: tg.Args<Arg>) {
	const arg = await tg.Args.apply<Arg, tg.ValueOrMaybeMutationMap<Arg>, Arg>({
		args,
		map: async (a) => a,
		reduce: {},
	});
	const host = arg.host ?? std.triple.host();
	const embedWrapper = arg.embedWrapper ?? std.triple.os(host) === "linux";

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const build = "./build.sh";
	const install: std.phases.PhaseArg = {
		pre: await tg`mkdir -p ${tg.output}/bin`,
		body: await tg`mv make ${tg.output}/bin`,
	};
	const phases: std.phases.Arg = {
		configure,
		build,
		install,
	};

	let envArgs: tg.Args<std.env.Arg> = [sdk(host)];
	if (embedWrapper) {
		envArgs.push({ TANGRAM_LINKER_EMBED_WRAPPER: true });
	}
	const env = std.env.compose(...envArgs);

	const output = await autotoolsInternal({
		sdk: "none",
		env,
		host,
		opt: "s",
		phases,
		prefixArg: "none",
		processName: metadata.name,
		source: source(),
	});
	return output;
}

export default build;

export async function test() {
	return std.assert.pkg(build, std.assert.defaultSpec(metadata));
}

/** The tests in this module, grouped by tier. */
export const tests = {
	bootstrap: [test],
};
