import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import dylibDetectOsPatch from "./bzip2_dylib_detect_os.patch" with {
	type: "file",
};

export const metadata = {
	name: "bzip2",
	version: "1.0.8",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269";
	const base = `https://sourceware.org/pub/${name}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, dylibDetectOsPatch));
};

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	const sourceDir = source_ ?? source();

	// Define phases.
	const buildPhase = `make CC="cc" SHELL="$SHELL" -f Makefile-libbz2_so && make CC="cc" SHELL="$SHELL"`;
	const install = {
		args: [`PREFIX="$OUTPUT" SHELL="$SHELL"`],
	};
	const phases: std.phases.PhasesArg = {
		configure: tg.Mutation.unset(),
		build: buildPhase,
		install,
	};

	const env = std.env.arg(env_, prerequisites(build), { utils: false });

	return await autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		buildInTree: true,
		env,
		phases,
		sdk,
		source: sourceDir,
		wrapBashScriptPaths: ["bin/bzdiff", "bin/bzgrep", "bin/bzmore"],
	});
};

export default build;

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({
		host,
		bootstrap: true,
		env: std.env.arg(sdk, { SHELL: "/bin/sh" }, { utils: false }),
	});
};
