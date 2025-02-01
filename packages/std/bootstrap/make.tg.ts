import * as std from "../tangram.ts";
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

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3";
	return std.download.fromGnu({ name, version, checksum });
});

export type Arg = {
	host?: string;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const { host } = await std.args.apply<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const build = {
		command: "./build.sh",
		args: tg.Mutation.unset(),
	};
	const install = {
		pre: "mkdir -p $OUTPUT/bin",
		body: {
			command: "cp make $OUTPUT/bin",
			args: tg.Mutation.unset(),
		},
	};
	const phases = {
		configure,
		build,
		install,
	};

	return std.autotools.build({
		env: sdk(host),
		host,
		opt: "s",
		phases,
		prefixArg: "none",
		sdk: false,
		source: source(),
	});
});

export default build;
export const test = tg.command(async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		bootstrapMode: true,
	};
	return await std.assert.pkg(build, spec);
});
