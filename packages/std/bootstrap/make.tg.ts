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
};

export async function build(...args: tg.Args<Arg>) {
	const arg = await tg.Args.apply<Arg, tg.ValueOrMaybeMutationMap<Arg>, Arg>({
		args,
		map: async (a) => a,
		reduce: {},
	});
	const host = arg.host ?? std.triple.host();

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const build = "./build.sh";
	const install: std.phases.PhaseArg = {
		pre: await tg`mkdir -p ${tg.output}/bin`,
		body: await tg`cp make ${tg.output}/bin`,
	};
	const phases: std.phases.Arg = {
		configure,
		build,
		install,
	};

	let envArgs: tg.Args<std.env.Arg> = [sdk(host)];
	if (std.triple.os(host) === "linux") {
		// Link a static executable, because the bootstrap utils cannot preserve the xattrs that record a wrapper's dependencies.
		envArgs.push({ CC: "cc -static", TANGRAM_LINKER_PASSTHROUGH: true });
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
	const output = await build();

	// On Linux, run it in a sandbox that receives nothing else, so that it must not depend on anything that the install did not record. On other hosts, the bootstrap install drops the xattrs that record wrapper dependencies, so only check that it builds.
	if (std.triple.os(std.triple.host()) === "linux") {
		const version = await std
			.build(std.shBootstrap`${output}/bin/make --version > ${tg.output}`)
			.then(tg.File.expect);
		tg.assert(
			(await version.text).startsWith(`GNU Make ${metadata.version}`),
			"expected the bootstrap make to run",
		);
	}

	return output;
}
