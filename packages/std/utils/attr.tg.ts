import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "attr",
	version: "2.6.0",
	tag: "attr/2.6.0",
};

export async function source() {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:6c8a2148a7b85043b68492bce43316b0e2e214fc4e628c7ede078e76e216330b";
	const base = `https://download-mirror.savannah.gnu.org/releases/${name}`;
	const mirrorBases = [
		`https://www.mirrorservice.org/sites/download.savannah.gnu.org/releases/${name}`,
		`https://mirror.csclub.uwaterloo.ca/nongnu/${name}`,
		`https://mirror.easyname.at/nongnu/${name}`,
		`https://savannah.c3sl.ufpr.br/${name}`,
		`https://download.savannah.gnu.org/releases/${name}`,
	];
	const archive = std.download.packageArchive({ name, version, extension });
	const mirrors = mirrorBases.map((mirrorBase) => `${mirrorBase}/${archive}`);
	return await std.download
		.extractArchive({ base, checksum, name, version, extension, mirrors })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
	staticBuild?: boolean;
	usePrerequisites?: boolean;
};

export async function build(arg?: tg.Unresolved<Arg>) {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		staticBuild = false,
		usePrerequisites = true,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	if (std.triple.os(host) !== "linux" || std.triple.os(build) !== "linux") {
		throw new Error(
			`Unsupported system: ${host}. The attr package is Linux-only.`,
		);
	}

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-silent-rules",
			"--disable-nls",
			"--disable-rpath",
			"--with-pic",
		],
	};
	if (staticBuild) {
		configure.args.push("--enable-static");
		configure.args.push("--disable-shared");
	}

	const sourceDir = source_ ?? source();

	const phases = { configure };

	const env: tg.Args<std.env.Arg> = [env_ ?? null];
	if (usePrerequisites) {
		env.push(prerequisites(build));
	}
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}

	return autotoolsInternal({
		build,
		host,
		env: std.env.compose(...env),
		phases,
		processName: metadata.name,
		...(staticBuild ? { opt: "s" as const } : {}),
		...std.args.optional("sdk", sdk),
		source: sourceDir,
	});
}

export default build;

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: "none", env: sdk });
}
