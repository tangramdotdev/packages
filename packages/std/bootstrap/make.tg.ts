import * as std from "../tangram.ts";
import { autotoolsInternal } from "../utils.tg.ts";
import { sdk } from "./sdk.tg.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/make/",
	license: "GPLv3",
	name: "make",
	repository: "https://savannah.gnu.org/projects/make/",
	version: "4.4.1",
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
};

export const build = async (...args: tg.Args<Arg>) => {
	const { host } = await std.args.apply<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const build = {
		command: "./build.sh",
		args: tg.Mutation.unset() as tg.Mutation<Array<tg.Template>>,
	};
	const install = {
		pre: "mkdir -p $OUTPUT/bin",
		body: {
			command: "cp make $OUTPUT/bin",
			args: tg.Mutation.unset() as tg.Mutation<Array<tg.Template>>,
		},
	};
	const phases: std.phases.Arg = {
		configure,
		build,
		install,
	};

	const env = std.env.arg(sdk(host));

	const output = await autotoolsInternal({
		env,
		host,
		opt: "s",
		phases,
		prefixArg: "none",
		sdk: false,
		source: source(),
	});
	return output;
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		bootstrapMode: true,
	};
	return await std.assert.pkg(build, spec);
};
