import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

export const metadata = {
	name: "patch_cmds",
	version: "66",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ce39ccafd2690e1f7cf825d20043a42614814e6f7bc9f7638fbbec328a0f282d";
	const owner = "apple-oss-distributions";
	const repo = name;
	const tag = std.download.packageName({ name, version });
	return std.download.fromGithub({
		checksum,
		source: "tag",
		owner,
		repo,
		tag,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

/** Produce an `patch` executable that preserves xattrs on macOS. */
export const macOsPatchCmds = tg.target(async (arg?: Arg) => {
	const build = arg?.build ?? (await std.triple.host());
	const os = std.triple.os(build);

	// Assert that the system is macOS.
	if (os !== "darwin") {
		throw new Error(`patchCmds is only supported on macOS, detected ${os}.`);
	}

	const sourceDir = await source();

	const script = tg`
		set -eux
		cp -R ${sourceDir}/patch/* .
		CC="cc"
		CFLAGS="-Wall -Oz"
		SOURCES="backupfile.c inp.c mkpath.c pch.c util.c patch.c vcs.c"
		OBJS=$(echo "$SOURCES" | sed 's/\.c$/\.o/')
		for src in $SOURCES; do
			obj=$(echo "$src" | sed 's/\.c$/\.o/')
			$CC $CFLAGS -c "$src" -o "$obj"
			if [ $? -ne 0 ]; then
				echo "Error compiling $src"
				exit 1
			fi
		done
		mkdir -p $OUTPUT/bin
		$CC $CFLAGS $OBJS -o $OUTPUT/bin/patch
		if [ $? -ne 0 ]; then
			echo "Linking failed"
			exit 1
		fi
		rm -f $OBJS
	`;

	const result = await tg
		.target(script, {
			host: std.triple.archAndOs(build),
			env: std.env.arg(arg?.env ?? {}, bootstrap.sdk.env()),
		})
		.then((target) => target.output())
		.then(tg.Directory.expect);

	return result;
});

export default macOsPatchCmds;
