import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import libarchive from "libarchive" with { source: "./libarchive.tg.ts" };
import xar from "xar" with { source: "./xar" };
import xz from "xz" with { source: "./xz.tg.ts" };
import zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://www.foundationdb.org/",
	license: "Apache-2.0",
	name: "foundationdb",
	repository: "https://github.com/apple/foundationdb",
	version: "7.3.77",
	tag: "foundationdb/7.3.77",
	provides: {
		binaries: ["fdbbackup", "fdbcli", "fdbdecode", "fdbmonitor", "fdbserver"],
		libraries: [
			{ name: "fdb_c", dylib: true, pkgConfigName: false, staticlib: false },
		],
	},
};

export type Arg = std.args.BasePackageArg;

export async function build(...args: tg.Args<Arg>) {
	const { build, host } = await std.packages.applyArgs<Arg>(...args);
	const os = std.triple.os(host);
	if (os === "linux") {
		return downloadLinuxPrebuilt(build, host);
	} else if (os === "darwin") {
		return downloadMacosPrebuilt(build, host);
	} else {
		return tg.unreachable(`unrecognized os ${os}`);
	}
}

export default build;

export async function downloadLinuxPrebuilt(build: string, host: string) {
	const { repository, version } = metadata;
	const build_ = std.triple.create(std.triple.normalize(build), {
		environment: "gnu",
	});
	const host_ = std.triple.create(std.triple.normalize(host), {
		environment: "gnu",
	});
	const libraryPaths = await Promise.all([
		zlib({ build: build_, host: host_ }).then((d) =>
			d.get("lib").then(tg.Directory.expect),
		),
		xz({ build: build_, host: host_ }).then((d) =>
			d.get("lib").then(tg.Directory.expect),
		),
	]);
	const binaries = metadata.provides.binaries;
	const checksums = linuxChecksums[host];
	tg.assert(checksums !== undefined, `unable to locate checksums for ${host}`);
	const arch = std.triple.arch(host);
	const base = `${repository}/releases/download/${version}`;
	const binDir = Object.fromEntries(
		await Promise.all(
			binaries.map(async (binary) => {
				const checksum = checksums[binary];
				const fileName = `${binary}.${arch}`;
				tg.assert(
					checksum !== undefined,
					`could not locate checksum for ${fileName}`,
				);
				const blob = await tg.download(`${base}/${fileName}`, checksum);
				tg.assert(blob instanceof tg.Blob);
				const file = await tg.file(blob, { executable: true });
				const wrapper = await std.wrap(file, { libraryPaths });
				return [binary, wrapper];
			}),
		),
	);
	const libChecksum = checksums["libfdb_c"];
	const libFileName = `libfdb_c.${arch}.so`;
	tg.assert(libChecksum, `could not locate checksum for ${libFileName}`);
	const libraryFile = tg.download(`${base}/${libFileName}`, libChecksum);
	return tg.directory({
		bin: binDir,
		lib: {
			["libfdb_c.so"]: libraryFile,
		},
	});
}

export async function downloadMacosPrebuilt(build: string, host: string) {
	const { repository, version } = metadata;
	const arch = std.triple.arch(host) === "aarch64" ? "arm64" : "x86_64";
	const checksum =
		arch === "arm64"
			? "sha256:aadeb7e4e530fdbefcf10255c45f4022165325ac43c4535a05559ed6d9ea1a37"
			: "sha256:b3c0fd18e744d9eaef1b5cf0b97103e587532f69a39d677f5613bda3c1dbc3fc";
	const base = `${repository}/releases/download/${version}`;
	const fileName = `FoundationDB-${version}_${arch}.pkg`;
	const url = `${base}/${fileName}`;
	const packageFile = await std.download({ url, checksum }).then((b) => {
		tg.assert(b instanceof tg.Blob);
		return tg.file(b);
	});

	return await $`
			WORKDIR=$(mktemp -d)
			cd $WORKDIR
			xar -xf ${packageFile}
			gunzip -dc FoundationDB-clients.pkg/Payload | bsdcpio -i
			gunzip -dc FoundationDB-server.pkg/Payload | bsdcpio -i
			mkdir ${tg.output}
			cd ${tg.output}
			mkdir -p bin
			mkdir -p etc/foundationdb
			mkdir -p include/foundationdb
			mkdir -p lib
			mkdir -p libexec
			mkdir -p share/foundationdb
			mkdir -p lib/python2.7/site-packages
	    cp -p $WORKDIR/usr/local/bin/fdbcli bin/
	    ln -sf ../libexec/backup_agent bin/dr_agent
	    ln -sf ../libexec/backup_agent bin/fdbbackup
	    ln -sf ../libexec/backup_agent bin/fdbdr
	    ln -sf ../libexec/backup_agent bin/fdbrestore
	    cp -p $WORKDIR/usr/local/libexec/fdbmonitor libexec/
	    cp -p $WORKDIR/usr/local/libexec/fdbserver libexec/
	    ln -sf ../libexec/fdbmonitor bin/fdbmonitor
	    ln -sf ../libexec/fdbserver bin/fdbserver
	    cp -p $WORKDIR/usr/local/foundationdb/backup_agent/backup_agent libexec/
	    cp -p $WORKDIR/usr/local/etc/foundationdb/foundationdb.conf.new etc/foundationdb/
	    cp -p $WORKDIR/usr/local/include/foundationdb/* include/foundationdb/
	    cp -p $WORKDIR/usr/local/lib/libfdb_c.dylib lib/
	    cp -rp $WORKDIR/Library/Python/2.7/site-packages/fdb lib/python2.7/site-packages/
	    mkdir -p share/foundationdb/launchdaemons
	    cp -p $WORKDIR/Library/LaunchDaemons/com.foundationdb.fdbmonitor.plist share/foundationdb/launchdaemons/
	    cp -p $WORKDIR/usr/local/foundationdb/README share/foundationdb/
	    cp -p $WORKDIR/usr/local/foundationdb/uninstall-FoundationDB.sh share/foundationdb/
	    mkdir -p share/foundationdb/resources
	    cp -rp $WORKDIR/Resources/* share/foundationdb/resources/
			rm -rf $WORKDIR
			`
		.env(libarchive({ host }), xar({ host }))
		.then(tg.Directory.expect);
}

const linuxChecksums: { [key: string]: { [key: string]: tg.Checksum } } = {
	["aarch64-linux"]: {
		fdbcli:
			"sha256:3695984379daa6983646b22e1313fc0e5e801d4f09eba452065432ba2cf5f34a",
		fdbserver:
			"sha256:2991a4d6676a57fc6905728e2a7d4c69acad3b8c8f03393e038680f67ec48832",
		fdbbackup:
			"sha256:49c10e988652da11880b7d5e80edb893e279e6f26fe6a6bd41f426e99b6fb2f7",
		fdbdecode:
			"sha256:6385b0b3b4ce1a19440c38cb1689e879fb40065ffeeb3366c2b5ff995a93ab80",
		fdbmonitor:
			"sha256:ffb704c5c7f76c2200b9ff5405e1f8c532dad2c348061cbce6abf4f0e5224342",
		libfdb_c:
			"sha256:cd080617d5ba235aeb9916b258a6a840bee5cc21e54be3599614e2aca58d605d",
	},
	["x86_64-linux"]: {
		fdbcli:
			"sha256:c3435972a57d98f76edafe456f2c73f967b8adf9d14970edea0b7091cd86ff95",
		fdbserver:
			"sha256:6fe47a94e623feee8706dfac4c4577710431b050901e77d10d7b66a884b5ada1",
		fdbbackup:
			"sha256:395db66de2d885118b04deb9702fda434cd335c8a649fc243a4f928e6d1d65f4",
		fdbdecode:
			"sha256:017e71eb676e9675e387b3f75a62fab52b04528a602713c4cdad67714bd067ca",
		fdbmonitor:
			"sha256:541011178ee57d764dec47d6e1475b389a5d95218c81ea1a846c7d4b8425f631",
		libfdb_c:
			"sha256:617572467897d0360f76ffc33f24b58090ee691e3273750d2ff334cc71aae3fa",
	},
};

export async function test() {
	const host = std.triple.host();
	const os = std.triple.os(host);

	// fdbdecode is only available on Linux.
	const binaries =
		os === "linux"
			? metadata.provides.binaries
			: metadata.provides.binaries.filter((b) => b !== "fdbdecode");

	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(binaries, {
			fdbdecode: { exitOnErr: false },
			fdbmonitor: { testArgs: ["--help"] },
		}),
	};
	return await std.assert.pkg(build, spec);
}
