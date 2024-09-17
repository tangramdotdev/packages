import * as std from "../tangram.ts";
import { sdk } from "./sdk.tg.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/make/",
	license: "GPLv3",
	name: "make",
	repository: "https://savannah.gnu.org/projects/make/",
	version: "4.4.1",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3";
	return std.download.fromGnu({ name, version, checksum });
});

export const build = tg.target(async (arg?: string) => {
	const host = arg ?? (await std.triple.host());

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

	const output = std.autotools.build({
		env: sdk(host),
		host,
		opt: "s",
		phases,
		prefixArg: "none",
		sdk: false,
		source: source(),
	});

	return output;
});

export default build;
