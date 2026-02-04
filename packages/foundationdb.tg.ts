import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };
import libarchive from "libarchive" with { local: "./libarchive.tg.ts" };
import xar from "xar" with { local: "./xar" };
import xz from "xz" with { local: "./xz.tg.ts" };
import zlib from "zlib" with { local: "./zlib.tg.ts" };

export const metadata = {
	homepage: "https://www.foundationdb.org/",
	license: "Apache-2.0",
	name: "foundationdb",
	repository: "https://github.com/apple/foundationdb",
	version: "7.4.5",
	tag: "foundationdb/7.4.5",
	provides: {
		binaries: ["fdbbackup", "fdbcli", "fdbdecode", "fdbmonitor", "fdbserver"],
		libraries: [
			{ name: "fdb_c", dylib: true, pkgConfigName: false, staticlib: false },
		],
	},
};

export type Arg = std.args.BasePackageArg;

export const build = async (...args: std.Args<Arg>) => {
	const { build, host } = await std.packages.applyArgs<Arg>(...args);
	const os = std.triple.os(host);
	if (os === "linux") {
		return downloadLinuxPrebuilt(build, host);
	} else if (os === "darwin") {
		return downloadMacosPrebuilt(build, host);
	} else {
		return tg.unreachable(`unrecognized os ${os}`);
	}
};

export default build;

export const downloadLinuxPrebuilt = async (build: string, host: string) => {
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
};

export const downloadMacosPrebuilt = async (build: string, host: string) => {
	const { repository, version } = metadata;
	const arch = std.triple.arch(host) === "aarch64" ? "arm64" : "x86_64";
	const checksum =
		arch === "arm64"
			? "sha256:ea9156125ba5fc67ed886a1d3365e4b973a5f0fa9345b11204f762aa48c9b1f0"
			: "sha256:6c48078e116ba694f8aab99944c3689709a4653732a2f879448eec7212dfbe6f";
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
};

const linuxChecksums: { [key: string]: { [key: string]: tg.Checksum } } = {
	["aarch64-linux"]: {
		fdbcli:
			"sha256:e3b4e413a0235a8c016a5fc8c2807e3f470f3cd986c87d526e95c842f2d5c574",
		fdbserver:
			"sha256:c9343d3d75fd48563505d4d80a0edfb1ee8905e9ccf1e851efd5b6b2f8dcdbc1",
		fdbbackup:
			"sha256:fcd95f5adabec0086449eeabab816daf798465489cc85ee924583309ab1cf0c0",
		fdbdecode:
			"sha256:abc30a428ae2294fead3d3fdae8627923fd5fe79c34314ecc1d196a82814dbd0",
		fdbmonitor:
			"sha256:7d0def72bf7bd6bbec3fdba039f39c632355c817484723f0f9267f735992bae1",
		libfdb_c:
			"sha256:ef99ec0aaf07d9c2f67411870b32f54ae64ff05021d26cc2c99428645e2ae8d0",
	},
	["x86_64-linux"]: {
		fdbcli:
			"sha256:bd267011f2795f0f00ab635f301bca3a3be86a61bbf4299ebef139a03e8da601",
		fdbserver:
			"sha256:cccc7f5cfc13e3912bc55c10831091cacb7ea726c2abc2b883e6fe31668afa84",
		fdbbackup:
			"sha256:4c182a4a112de70f3e0431e4cd186b0f39c267eedab4a563cfbf0e8403fb66fc",
		fdbdecode:
			"sha256:ec2df185aaa42b1128b7226c5f3c701521f870955f032174dbeb0927098724ae",
		fdbmonitor:
			"sha256:2a4be59eac44145f71a634a66742813fda08b33c41d920c13be06a6dddc633cc",
		libfdb_c:
			"sha256:f3eb95d649fc9a2193cfa22d6871ad01c03b23c341f2b6e8e4668a0f5609a1f4",
	},
};

export const test = async () => {
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
			fdbdecode: { skipRun: true },
			fdbmonitor: { testArgs: ["--help"] },
		}),
	};
	return await std.assert.pkg(build, spec);
};
