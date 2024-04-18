import ncurses from "tg:ncurses" with { path: "../ncurses" };
import perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/gettext",
	license: "GPL-3.0-or-later",
	name: "gettext",
	repository: "https://git.savannah.gnu.org/git/gettext.git",
	version: "0.22.5",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:fe10c37353213d78a5b83d48af231e005c4da84db5ce88037d88355938259640";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compressionFormat: "xz",
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let gettext = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-rpath",
			"--enable-relocatable",
			"--without-emacs",
			"--without-git",
		],
	};
	let phases = { configure };

	let dependencies = [ncurses(arg), perl(arg)];
	let env = [...dependencies, env_];

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap output binaries.
	let libDir = tg.Directory.expect(await output.get("lib"));
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths: [libDir] });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default gettext;

export let test = tg.target(async () => {
	let directory = gettext();
	await std.assert.pkg({
		directory,
		binaries: ["msgfmt", "msgmerge", "xgettext"],
		metadata,
	});
	return directory;
});
