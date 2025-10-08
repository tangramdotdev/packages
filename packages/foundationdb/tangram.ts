import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import libarchive from "libarchive" with { local: "../libarchive" };
import xar from "xar" with { local: "../xar" };
import xz from "xz" with { local: "../xz" };
import zlib from "zlib" with { local: "../zlib" };

export const metadata = {
	homepage: "https://www.foundationdb.org/",
	license: "Apache-2.0",
	name: "foundationdb",
	repository: "https://github.com/apple/foundationdb",
	version: "7.3.63",
	tag: "foundationdb/7.3.63",
	provides: {
		binaries: ["fdbbackup", "fdbcli", "fdbdecode", "fdbmonitor", "fdbserver"],
		libraries: [{ name: "fdb_c", dylib: true, staticlib: false }],
	},
};

export type Arg = {
	build?: string;
	host?: string;
};

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
			? "sha256:b7c65742ad6a9ae1eddd347031a8946546ad35d594a4c78e1448dd9094282135"
			: "sha256:0630fd903646f4c5c777c2341ec3671899e2dcc7eca3b4ad8a53c86eb4e8baa6";
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
			mkdir $OUTPUT
			cd $OUTPUT
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
			"sha256:a313bf868b06bc86c658efe81b980a62d59223eb4152d61d787534a4e4090066",
		fdbserver:
			"sha256:dc05545dcf40a7f064e033c0b44683699e40ba3925e6c3d7beb49729c061131d",
		fdbbackup:
			"sha256:d91d683b8a7ad06a21b1c817fb124660903e04453f55c5f867800768e881c615",
		fdbdecode:
			"sha256:792c49190ea21a01a1492f5e940b1e6f764f6e73d52ecb77e0be3ce58d89b6f3",
		fdbmonitor:
			"sha256:f008eda358d79708d41beda6da3b459871132184acc6a5900149ea269f7b1fc0",
		libfdb_c:
			"sha256:701d8c192bb4dcf5e703e6c880cb67421a75e0920d9364f5ccc60fd72b1824a2",
	},
	["x86_64-linux"]: {
		fdbcli:
			"sha256:b9080a774847c0648e7f4e030cf5e3f309a170c1ab83de463b7b08493ed3ee57",
		fdbserver:
			"sha256:4b10b947e4576e0bdbac35b11c049de382c541aecd1efbdce39c69a525b74400",
		fdbbackup:
			"sha256:e3b425d544f3133900928bdb94f33521faa3cc205e09287e26068aef2ecde408",
		fdbdecode:
			"sha256:f561eb9bb407fe5a6f1660c848ed51faf174a4322d324208ebec486cb006c2c0",
		fdbmonitor:
			"sha256:c31f41275b4c328248aff26f4dd8380f1115c4aa1d067ed4919a56403e554125",
		libfdb_c:
			"sha256:96ac2c2890d6e2fcae1bac1c17f6c3eb2a5bae7edd29d78d714d2f733b042267",
	},
};

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: [
			"fdbbackup",
			"fdbcli",
			{ name: "fdbmonitor", testArgs: ["--help"] },
			"fdbserver",
		],
	};
	return await std.assert.pkg(build, spec);
};
