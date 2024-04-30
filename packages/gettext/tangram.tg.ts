import attr from "tg:attr" with { path: "../attr" };
import libiconv from "tg:libiconv" with { path: "../libiconv" };
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
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-relocatable",
			"--without-emacs",
			"--without-git",
		],
	};
	let phases = { configure };

	let ncursesArtifact = await ncurses({ ...rest, build, env: env_, host });
	let dependencies: tg.Unresolved<std.env.Arg> = [
		ncursesArtifact,
		perl({ ...rest, build, env: env_, host }),
	];
	let attrArtifact;
	if (os === "darwin") {
		dependencies.push(libiconv({ ...rest, build, env: env_, host }));
	} else if (os === "linux") {
		attrArtifact = await attr({ ...rest, build, env: env_, host });
		dependencies.push(attrArtifact);
	}
	let env = [
		...dependencies,
		{ TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "filter" },
		env_,
	];

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
	let libraryPaths = [
		libDir,
		tg.Directory.expect(await ncursesArtifact.get("lib")),
	];
	if (os === "linux") {
		tg.assert(attrArtifact);
		let attrDir = tg.Directory.expect(await attrArtifact.get("lib"));
		libraryPaths.push(attrDir);
	}
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default gettext;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: gettext,
		binaries: ["msgfmt", "msgmerge", "xgettext"],
		metadata,
	});
	return true;
});
