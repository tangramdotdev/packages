import * as libcap from "libcap" with { local: "./libcap.tg.ts" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as liburcu from "liburcu" with { local: "./liburcu.tg.ts" };
import * as libuv from "libuv" with { local: "./libuv.tg.ts" };
import * as libxml2 from "libxml2" with { local: "./libxml2.tg.ts" };
import * as openssl from "openssl" with { local: "./openssl.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as zlib from "zlib" with { local: "./zlib.tg.ts" };

export const metadata = {
	homepage: "https://www.isc.org/bind/",
	license: "MPL-2.0",
	name: "bind",
	repository: "https://gitlab.isc.org/isc-projects/bind9",
	version: "9.20.16",
	tag: "bind/9.20.16",
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

const deps = await std.deps({
	libcap: {
		build: libcap.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "linux",
	},
	libiconv: {
		build: libiconv.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "darwin",
	},
	liburcu: liburcu.build,
	libuv: libuv.build,
	libxml2: libxml2.build,
	openssl: openssl.build,
	zlib: zlib.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			phases: {
				configure: {
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
				},
			},
		},
		...args,
	);

	const os = std.triple.os(arg.host);

	// On Linux, the linker needs help finding sibling libraries in the build tree.
	// We customize the build phase to pass LDFLAGS with rpath-link directly to make.
	let setRuntimeLibraryPath = arg.setRuntimeLibraryPath;
	let phases = arg.phases;
	if (os === "linux") {
		setRuntimeLibraryPath = true;
		phases = await std.phases.mergePhases(phases, {
			build: {
				command: tg`
					TOP="$(pwd)"
					RPATH_LINK=""
					for lib in isc dns ns isccfg isccc; do
						RPATH_LINK="$RPATH_LINK -Wl,-rpath-link,$TOP/lib/$lib/.libs"
					done
					make LDFLAGS="$LDFLAGS $RPATH_LINK" -j$(nproc)
				`,
				args: tg.Mutation.set([]),
			},
		});
	}

	let output = await std.autotools.build({
		...arg,
		setRuntimeLibraryPath,
		phases,
	});

	// On Linux, wrap all ELF binaries with the package's lib directory to ensure
	// transitive library dependencies like libns are found at runtime.
	if (os === "linux") {
		const libDir = await output.get("lib").then(tg.Directory.expect);
		const libraryPaths = [libDir];
		const binDir = await output.get("bin").then(tg.Directory.expect);
		for await (const [name, artifact] of binDir) {
			if (artifact instanceof tg.File) {
				const { format } = await std.file.executableMetadata(artifact);
				if (format === "elf") {
					const unwrapped = binDir.get(name).then(tg.File.expect);
					const wrapped = std.wrap(unwrapped, { libraryPaths });
					output = await tg.directory(output, {
						[`bin/${name}`]: wrapped,
					});
				}
			}
		}
	}

	return output;
};

export default build;

export const test = async () => {
	const os = std.triple.os(std.triple.host());
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
