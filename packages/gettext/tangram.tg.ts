import * as acl from "tg:acl" with { path: "../acl" };
import * as attr from "tg:attr" with { path: "../attr" };
import * as libiconv from "tg:libiconv" with { path: "../libiconv" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as std from "tg:std" with { path: "../std" };
import * as xz from "tg:xz" with { path: "../xz" };

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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		acl?: acl.Arg;
		attr?: attr.Arg;
		libiconv?: libiconv.Arg;
		ncurses?: ncurses.Arg;
		perl?: perl.Arg;
		pkgconfig?: pkgconfig.Arg;
		xz?: xz.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		dependencies: {
			acl: aclArg = {},
			attr: attrArg = {},
			libiconv: libiconvArg = {},
			ncurses: ncursesArg = {},
			perl: perlArg = {},
			pkgconfig: pkgconfigArg = {},
			xz: xzArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-relocatable",
			"--with-included-glib",
			"--with-included-libcroco",
			"--with-included-libunistring",
			"--with-included-libxml",
			"--without-emacs",
			"--without-git",
		],
	};
	if (os === "darwin") {
		// NOTE - this bundles libintl.h, which is provided on Linux by glibc.
		configure.args.push("--with-included-gettext");
		// Allow the build process to locate libraries from the compile-time library path.
		configure.args.push("DYLD_FALLBACK_LIBRARY_PATH=$LIBRARY_PATH");
	}
	let phases = { configure };

	let ncursesArtifact = await ncurses.build(ncursesArg);
	let dependencies: tg.Unresolved<Array<std.env.Arg>> = [
		ncursesArtifact,
		perl.build(perlArg),
		pkgconfig.build(pkgconfigArg),
		xz.build(xzArg),
	];
	let aclArtifact = undefined;
	let attrArtifact = undefined;

	let libiconvArtifact = await libiconv.build(libiconvArg);
	dependencies.push(libiconvArtifact);
	if (os === "linux") {
		aclArtifact = await acl.build(aclArg);
		attrArtifact = await attr.build(attrArg);
		dependencies.push(aclArtifact);
		dependencies.push(attrArtifact);
	}
	let env = [...dependencies, env_];

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
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
		let aclDir = tg.Directory.expect(await aclArtifact?.get("lib"));
		let attrDir = tg.Directory.expect(await attrArtifact?.get("lib"));
		libraryPaths.push(aclDir);
		libraryPaths.push(attrDir);
	}
	let libiconvDir = tg.Directory.expect(await libiconvArtifact.get("lib"));
	libraryPaths.push(libiconvDir);
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["msgfmt", "msgmerge", "xgettext"],
		metadata,
	});
	return true;
});
