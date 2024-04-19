import * as std from "../tangram.tg.ts";
import { sdk } from "./sdk.tg.ts";

export let metadata = {
	homepage: "https://www.gnu.org/software/make/",
	license: "GPLv3",
	name: "make",
	repository: "https://savannah.gnu.org/projects/make/",
	version: "4.4.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3";
	return std.download.fromGnu({ name, version, checksum });
});

export let build = tg.target(async (arg?: string) => {
	let host = arg ?? (await std.triple.host());

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let build = {
		command: "./build.sh",
		args: tg.Mutation.unset(),
	};
	let install = {
		pre: "mkdir -p $OUTPUT/bin",
		body: {
			command: "cp make $OUTPUT/bin",
			args: tg.Mutation.unset(),
		},
	};
	let phases = {
		configure,
		build,
		install,
	};

	let output = std.autotools.build({
		host,
		opt: "s",
		phases,
		prefixArg: "none",
		sdk: sdk.arg(host),
		source: source(),
	});

	return output;
});

export default build;
