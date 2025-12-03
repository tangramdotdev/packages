import * as libcap from "libcap" with { local: "../libcap" };
import * as libiconv from "libiconv" with { local: "../libiconv" };
import * as liburcu from "liburcu" with { local: "../liburcu" };
import * as libuv from "libuv" with { local: "../libuv" };
import * as libxml2 from "libxml2" with { local: "../libxml2" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as std from "std" with { local: "../std" };
import * as zlib from "zlib" with { local: "../zlib" };

export const metadata = {
	homepage: "https://www.isc.org/bind/",
	license: "MPL-2.0",
	name: "bind",
	repository: "https://gitlab.isc.org/isc-projects/bind9",
	version: "9.20.16",
	provides: {
		binaries: [
			"arpaname",
			"delv",
			"dig",
			"dnssec-cds",
			"dnssec-dsfromkey",
			"dnssec-importkey",
			"dnssec-keyfromlabel",
			"dnssec-keygen",
			"dnssec-ksr",
			"dnssec-revoke",
			"dnssec-settime",
			"dnssec-signzone",
			"dnssec-verify",
			"host",
			"mdig",
			"named-checkconf",
			"named-checkzone",
			"named-compilezone",
			"named-journalprint",
			"named-rrchecker",
			"nsec3hash",
			"nslookup",
			"nsupdate",
		],
		libraries: ["dns", "isc", "isccc", "isccfg", "ns"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:03ffcc7a4fcb7c39b82b34be1ba2b59f6c191bc795c5935530d5ebe630a352d6";
	const extension = ".tar.xz";
	const base = `https://downloads.isc.org/isc/bind9/${version}`;
	return std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		libcap?: std.args.DependencyArg<libcap.Arg>;
		libiconv?: std.args.DependencyArg<libiconv.Arg>;
		liburcu?: std.args.DependencyArg<liburcu.Arg>;
		libuv?: std.args.DependencyArg<libuv.Arg>;
		libxml2?: std.args.DependencyArg<libxml2.Arg>;
		openssl?: std.args.DependencyArg<openssl.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const os = std.triple.os(host ?? (await std.triple.host()));
	const deps = [
		std.env.runtimeDependency(liburcu.build, dependencyArgs.liburcu),
		std.env.runtimeDependency(libuv.build, dependencyArgs.libuv),
		std.env.runtimeDependency(libxml2.build, dependencyArgs.libxml2),
		std.env.runtimeDependency(openssl.build, dependencyArgs.openssl),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	];
	if (os === "darwin") {
		deps.push(
			std.env.runtimeDependency(libiconv.build, dependencyArgs.libiconv),
		);
	} else if (os === "linux") {
		deps.push(std.env.runtimeDependency(libcap.build, dependencyArgs.libcap));
	}

	const env: tg.Unresolved<Array<std.env.Arg>> = [
		...deps.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	];

	const configure = {
		args: [
			"--disable-doh",
			"--disable-geoip",
			"--without-cmocka",
			"--without-gssapi",
			"--without-json-c",
			"--without-libidn2",
			"--without-libnghttp2",
			"--without-lmdb",
			"--without-maxminddb",
		],
	};

	// On Linux, the linker needs help finding sibling libraries in the build tree.
	// We customize the build phase to pass LDFLAGS with rpath-link directly to make.
	const buildPhase =
		os === "linux"
			? {
					command: tg`
						TOP="$(pwd)"
						RPATH_LINK=""
						for lib in isc dns ns isccfg isccc; do
							RPATH_LINK="$RPATH_LINK -Wl,-rpath-link,$TOP/lib/$lib/.libs"
						done
						make LDFLAGS="$LDFLAGS $RPATH_LINK" -j$(nproc)
					`,
					args: tg.Mutation.set([]),
				}
			: undefined;

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...env),
			phases: { configure, build: buildPhase },
			sdk,
			setRuntimeLibraryPath: os === "linux",
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const os = std.triple.os(await std.triple.host());
	const runtimeDeps: Array<tg.Unresolved<tg.Directory>> = [
		liburcu.build(),
		libuv.build(),
		libxml2.build(),
		openssl.build(),
		zlib.build(),
	];
	if (os === "darwin") {
		runtimeDeps.push(libiconv.build());
	} else if (os === "linux") {
		runtimeDeps.push(libcap.build());
	}
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			skipRun: true,
		}),
		libraries: std.assert.allLibraries(metadata.provides.libraries, {
			pkgConfigName: false,
			staticlib: false,
			runtimeDeps,
		}),
	};
	return await std.assert.pkg(build, spec);
};
