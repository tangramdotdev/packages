import * as acl from "tg:acl" with { path: "../acl" };
import * as attr from "tg:attr" with { path: "../attr" };
import * as bison from "tg:bison" with { path: "../bison" };
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
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			acl: aclArg = {},
			attr: attrArg = {},
			libiconv: libiconvArg = {},
			ncurses: ncursesArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let os = std.triple.os(host);

	// Set up default build dependencies.
	let buildDependencies = [];
	let bisonForBuild = bison.build({ build, host: build }).then((d) => {
		return { BISON: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(bisonForBuild);
	let pkgConfigForBuild = pkgconfig.build({ build, host: build }).then((d) => {
		return { PKGCONFIG: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(pkgConfigForBuild);
	let perlForBuild = perl.build({ build, host: build }).then((d) => {
		return { PERL: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(perlForBuild);
	let xzForBuild = xz.build({ build, host: build }).then((d) => {
		return { XZ: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(xzForBuild);

	// Set up host dependencies.
	let hostDependencies = [];
	let aclForHost = undefined;
	let attrForHost = undefined;
	let libiconvForHost = undefined;
	if (os === "linux") {
		aclForHost = await acl.build({ build, host, sdk }, aclArg);
		hostDependencies.push(aclForHost);
		attrForHost = await attr.build({ build, host, sdk }, attrArg);
		hostDependencies.push(attrForHost);
		// Work around a warning using the glibc-provided iconv.
		hostDependencies.push({
			CFLAGS: tg.Mutation.suffix("-Wno-incompatible-pointer-types", " "),
		});
	}
	if (os === "darwin") {
		libiconvForHost = await libiconv.build({ build, host, sdk }, libiconvArg);
		hostDependencies.push(libiconvForHost);
	}
	let ncursesForHost = await ncurses.build({ build, host, sdk }, ncursesArg);
	hostDependencies.push(ncursesForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_, {
		TANGRAM_LD_PROXY_TRACING: "tangram=trace",
	});

	// Add final build dependencies to env.
	let resolvedBuildDependencies = [];
	let finalBison = await std.env.getArtifactByKey({ env, key: "BISON" });
	resolvedBuildDependencies.push(finalBison);
	let finalPkgConfig = await std.env.getArtifactByKey({
		env,
		key: "PKGCONFIG",
	});
	resolvedBuildDependencies.push(finalPkgConfig);
	let finalPerl = await std.env.getArtifactByKey({ env, key: "PERL" });
	resolvedBuildDependencies.push(finalPerl);
	let finalXz = await std.env.getArtifactByKey({ env, key: "XZ" });
	resolvedBuildDependencies.push(finalXz);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

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

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
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
