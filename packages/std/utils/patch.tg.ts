import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import rlimitFix from "./patch-rlimit-fix.patch" with { type: "file" };

export const metadata = {
	name: "patch",
	version: "2.7.6",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ac610bda97abe0d9f6b7c963255a11dcb196c25e337c61f94e4778d632f1d8fd";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
	// Apply rlimit fix.
	// See https://savannah.gnu.org/bugs/index.php?62958
	source = await bootstrap.patch(source, rlimitFix);
	return source;
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.target(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(env_, prerequisites(build));

	const output = buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	return output;
});

export default build;

export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
