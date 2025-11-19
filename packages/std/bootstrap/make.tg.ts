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

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3";
	return std.download.fromGnu({ name, version, checksum });
};

export type Arg = {
	host?: string;
	embedWrapper?: boolean | undefined;
};

export const build = async (arg?: Arg) => {
	const host = arg?.host ?? (await std.triple.host());
	const embedWrapper = arg?.embedWrapper ?? std.triple.os(host) === "linux";

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const build: std.phases.CommandArg = {
		command: "./build.sh",
		args: tg.Mutation.unset(),
	};
	const install: std.phases.PhaseArg = {
		pre: await tg`mkdir -p ${tg.output}/bin`,
		body: {
			command: await tg`cp make ${tg.output}/bin`,
			args: tg.Mutation.unset(),
		},
	};
	const phases: std.phases.Arg = {
		configure,
		build,
		install,
	};

	let envArgs: Array<tg.Unresolved<std.env.Arg>> = [
		sdk(host),
		{ utils: false },
	];
	if (embedWrapper) {
		envArgs.push({ TGLD_EMBED_WRAPPER: true });
	}
	const env = std.env.arg(...envArgs, { TGLD_TRACING: "tgld=trace" });

	const output = await autotoolsInternal({
		bootstrap: true,
		env,
		host,
		opt: "s",
		phases,
		prefixArg: "none",
		source: source(),
	});
	return output;
};

export default build;

export const test = async () => {
	// const spec = {
	// 	...std.assert.defaultSpec(metadata),
	// 	bootstrapMode: true,
	// };
	// FIXME - must be args to use std.assert.pkg.
	// return await std.assert.pkg(build, spec);
	return await build();
};
