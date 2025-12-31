import * as std from "../tangram.ts";
import { sdk as bootstrapSdk } from "../bootstrap.tg.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/libtool",
	license: "GPL-3.0-or-later",
	name: "libtool",
	repository: "https://git.savannah.gnu.org/git/libtool.git",
	version: "2.5.4",
	tag: "libtool/2.5.4",
	provides: {
		binaries: ["libtool", "libtoolize"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f81f5860666b0bc7d84baddefa60d1cb9fa6fceb2398cc3baca6afaa60266675";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = {
	bootstrap?: boolean;
	bashExe: tg.File;
	grepExe: tg.File;
	sedExe: tg.File;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const {
		bootstrap = false,
		bashExe,
		grepExe,
		sedExe,
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await tg.resolve(arg);

	const env = std.env.arg(env_, { utils: false });
	let output = await std.utils.autotoolsInternal({
		build,
		host,
		bootstrap,
		env,
		processName: metadata.name,
		sdk,
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
			["_lt_pkgdatadir"]: tg.Mutation.setIfUnset<tg.Template.Arg>(
				tg`${output}/share/libtool`,
			),
			EGREP: tg.Mutation.setIfUnset<tg.Template.Arg>(tg`${grepExe} -E`),
			FGREP: tg.Mutation.setIfUnset<tg.Template.Arg>(tg`${grepExe} -F`),
			GREP: tg.Mutation.setIfUnset<tg.Template.Arg>(grepExe),
			SED: tg.Mutation.setIfUnset<tg.Template.Arg>(sedExe),
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
};

export default build;
