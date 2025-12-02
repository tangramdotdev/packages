import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import dylibDetectOsPatch from "./bzip2_dylib_detect_os.patch" with {
	type: "file",
};

export const metadata = {
	name: "bzip2",
	version: "1.0.8",
	tag: "bzip2/1.0.8",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:db106b740252669664fd8f3a1c69fe7f689d5cd4b132f82ba82b9afba27627df";
	const owner = "libarchive";
	const repo = name;
	const tag = `${name}-${version}`;
	return await std.download.fromGithub({
		checksum,
		repo,
		tag,
		owner,
		source: "tag",
	});
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
		args: [await tg`PREFIX="${tg.output}" SHELL="$SHELL"`],
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
