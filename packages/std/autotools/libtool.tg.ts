import * as std from "../tangram.ts";
import { sdk as bootstrapSdk } from "../bootstrap.tg.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/libtool",
	license: "GPL-3.0-or-later",
	name: "libtool",
	repository: "https://git.savannah.gnu.org/git/libtool.git",
	version: "2.6.2",
	tag: "libtool/2.6.2",
	provides: {
		binaries: ["libtool", "libtoolize"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:2ef1067c16c97db930fd740cc9bc3d3ba9a583804ae5ac42cc3e8719e49e191e";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
}

export type Arg = {
	bashExe: tg.File;
	grepExe: tg.File;
	sedExe: tg.File;
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(arg: tg.Unresolved<Arg>) {
	const {
		bashExe,
		grepExe,
		sedExe,
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await tg.resolve(arg);

	const env = std.env.compose(env_ ?? null);
	let output = await std.utils.autotoolsInternal({
		build: build ?? null,
		host: host ?? null,
		env,
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
		source: source_ ?? source(),
	});

	// Add a symlink to the m4 macros.
	output = await tg.directory(output, {
		[`share/libtool/m4`]: tg.symlink("../aclocal"),
	});

	const bashScripts = ["libtool", "libtoolize"];
	for (const script of bashScripts) {
		const file = tg.File.expect(await output.get(`bin/${script}`));
		const scriptEnv = {
			["_lt_pkgdatadir"]: tg.Mutation.setIfUnset(tg`${output}/share/libtool`),
			EGREP: tg.Mutation.setIfUnset(tg`${grepExe} -E`),
			FGREP: tg.Mutation.setIfUnset(tg`${grepExe} -F`),
			GREP: tg.Mutation.setIfUnset(grepExe),
			SED: tg.Mutation.setIfUnset(sedExe),
		};
		output = await tg.directory(output, {
			[`bin/${script}`]: std.wrap({
				executable: file,
				interpreter: bashExe,
				buildToolchain: bootstrapSdk(),
				env: scriptEnv,
			}),
		});
	}

	return output;
}

export default build;
