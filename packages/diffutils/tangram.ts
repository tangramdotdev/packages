import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/diffutils/",
	license: "GPL-3.0-or-later",
	name: "diffutils",
	repository: "https://git.savannah.gnu.org/cgit/diffutils.git",
	version: "3.8",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a6bdd7d1b31266d11c4f4de6c1b748d4607ab0231af5188fc2533d0ae2438fec";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compressionFormat: "xz",
	});
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default default_;

export const test = tg.target(async () => {
	return await $`
			echo "Checking that we can run diffutils." | tee $OUTPUT
			diff --version | tee -a $OUTPUT
			diff3 --version | tee -a $OUTPUT
			cmp --version | tee -a $OUTPUT
		`.env(default_());
});
