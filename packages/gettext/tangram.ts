import * as acl from "acl" with { path: "../acl" };
import * as attr from "attr" with { path: "../attr" };
import * as bison from "bison" with { path: "../bison" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as perl from "perl" with { path: "../perl" };
import * as pkgConfig from "pkg-config" with { path: "../pkg-config" };
import * as std from "std" with { path: "../std" };
import * as xz from "xz" with { path: "../xz" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gettext",
	license: "GPL-3.0-or-later",
	name: "gettext",
	repository: "https://git.savannah.gnu.org/git/gettext.git",
	version: "0.22.5",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
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

	const os = std.triple.os(host);

	// Set up default build dependencies.
	const buildDependencies = [];
	const bisonForBuild = bison.default_({ build, host: build }).then((d) => {
		return { BISON: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(bisonForBuild);
	const pkgConfigForBuild = pkgConfig
		.default_({ build, host: build })
		.then((d) => {
			return { PKGCONFIG: std.directory.keepSubdirectories(d, "bin") };
		});
	buildDependencies.push(pkgConfigForBuild);
	const perlForBuild = perl.default_({ build, host: build }).then((d) => {
		return { PERL: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(perlForBuild);
	const xzForBuild = xz.default_({ build, host: build }).then((d) => {
		return { XZ: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(xzForBuild);

	// Set up host dependencies.
	const hostDependencies = [];
	let aclForHost = undefined;
	let attrForHost = undefined;
	let libiconvForHost = undefined;
	if (os === "linux") {
		aclForHost = await acl.default_({ build, host, sdk }, aclArg);
		hostDependencies.push(aclForHost);
		attrForHost = await attr.default_({ build, host, sdk }, attrArg);
		hostDependencies.push(attrForHost);
		// Work around a warning using the glibc-provided iconv.
		hostDependencies.push({
			CFLAGS: tg.Mutation.suffix("-Wno-incompatible-pointer-types", " "),
		});
	}
	if (os === "darwin") {
		libiconvForHost = await libiconv.default_(
			{ build, host, sdk },
			libiconvArg,
		);
		hostDependencies.push(libiconvForHost);
	}
	const ncursesForHost = await ncurses.default_(
		{ build, host, sdk },
		ncursesArg,
	);
	hostDependencies.push(ncursesForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_);

	// Add final build dependencies to env.
	const resolvedBuildDependencies = [];
	const finalBison = await std.env.getArtifactByKey({ env, key: "BISON" });
	resolvedBuildDependencies.push(finalBison);
	const finalPkgConfig = await std.env.getArtifactByKey({
		env,
		key: "PKGCONFIG",
	});
	resolvedBuildDependencies.push(finalPkgConfig);
	const finalPerl = await std.env.getArtifactByKey({ env, key: "PERL" });
	resolvedBuildDependencies.push(finalPerl);
	const finalXz = await std.env.getArtifactByKey({ env, key: "XZ" });
	resolvedBuildDependencies.push(finalXz);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

	const configure = {
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
	const phases = { configure };

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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFn: default_,
		binaries: ["msgfmt", "msgmerge", "xgettext"],
		metadata,
	});
	return true;
});
