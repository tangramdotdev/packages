import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import libarchive from "libarchive" with { source: "./libarchive.tg.ts" };
import xar from "xar" with { source: "./xar" };
import xz from "xz" with { source: "./xz.tg.ts" };
import zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://www.foundationdb.org/",
	license: "Apache-2.0",
	name: "foundationdb",
	repository: "https://github.com/apple/foundationdb",
	version: "7.4.6",
	tag: "foundationdb/7.4.6",
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
			? "sha256:6728c036d2ddbe1bab411db4c6966c7d6677036e5fa04e085764a3f6669ca99e"
			: "sha256:f58171a27c0ed23041a3d53245191f4851d521379690f384de4db325cb4fe37b";
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
			"sha256:fcd253e758ee3257f4a2acf11824fa49bf4fb8f540f3702b7fb2bb5936364498",
		fdbserver:
			"sha256:ebf926fdcccf5a0b8847cad4efdecb4d764eff4971d74d8598193a9385f5e9a2",
		fdbbackup:
			"sha256:d75201f732cdfc0e49daccada04f3f2ef2af0fd9c34ca1cffedf15e7165a8775",
		fdbdecode:
			"sha256:5ab543b2c8d8e01282b74dcc1ac2bdfa620427ff44d17bc3877fb8c3456023cb",
		fdbmonitor:
			"sha256:7e694f7be6006e858df2bf2652263010719b4b3c6f56ba495e2e13e0902ce29c",
		libfdb_c:
			"sha256:69ba4f4899f39a5fae6dbd765d586056a2d9d41896c0f60e4549e76a7de3ea03",
	},
	["x86_64-linux"]: {
		fdbcli:
			"sha256:b0e47b9bd03addc745ba7ee283fa7a0c5fd7bfe2fa9d99bfb63692369d5659c6",
		fdbserver:
			"sha256:2e9bd4ce461821c5d978e1119d4065e7f2db8da77655273a2ddd31177543aa18",
		fdbbackup:
			"sha256:3f5be8bc62a738cefd3a03f9d07be4924f6eb4896a5171c0085758f4480f2245",
		fdbdecode:
			"sha256:e1c0b437821bfd9aea3b1b8c0b3296d720de5ac96fae6c9784f39c1422d092c9",
		fdbmonitor:
			"sha256:4256b67f603909f4739578c7c216dc03660d6de1440c5ff54939e78bc088bd5c",
		libfdb_c:
			"sha256:d1a097c3947fbc4aadfbfcb42daac101b4150160656377fba19bcdbe4656513c",
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
