import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import zlib from "zlib" with { path: "../zlib" };
import xz from "xz" with { path: "../xz" };

export const metadata = {
	homepage: "https://www.foundationdb.org/",
	license: "Apache-2.0",
	name: "foundationdb",
	repository: "https://github.com/apple/foundationdb",
	version: "7.3.63",
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
	const build_ = std.triple.create(std.triple.normalize(build), {
		environment: "gnu",
	});
	const host_ = std.triple.create(std.triple.normalize(host), {
		environment: "gnu",
	});
	// const libraryPaths = await Promise.all([
	// 	zlib({ build: build_, host: host_ }).then((d) =>
	// 		d.get("lib").then(tg.Directory.expect),
	// 	),
	// 	xz({ build: build_, host: host_ }).then((d) =>
	// 		d.get("lib").then(tg.Directory.expect),
	// 	),
	// ]);
	const libraryPaths = [await tg.directory()];
	const os = std.triple.os(host);
	if (os === "linux") {
		return downloadLinuxPrebuilt(host, libraryPaths);
	} else if (os === "darwin") {
		return downloadMacosPrebuilt(host, libraryPaths);
	} else {
		return tg.unreachable(`unrecognized os ${os}`);
	}
};

export default build;

export const downloadLinuxPrebuilt = async (
	host: string,
	libraryPaths: Array<tg.Directory>,
) => {
	const { repository, version } = metadata;
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

export const downloadMacosPrebuilt = async (
	host: string,
	libraryPaths: Array<tg.Directory>,
) => {
	const { repository, version } = metadata;
	const binaries = metadata.provides.binaries;
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
			set -ex

			# Create working directory
			WORK_DIR=$(mktemp -d)
			mkdir -p $OUTPUT/bin $OUTPUT/lib

			# Extract the package using xar (pkg files are xar archives)
			cd $WORK_DIR

			# Try to extract as xar archive first
			if command -v xar >/dev/null 2>&1; then
				xar -xf ${packageFile}
			else
				# Fallback: try to extract using ar if xar is not available
				if command -v ar >/dev/null 2>&1; then
					ar -x ${packageFile}
				else
					# Last resort: try as tar archive (some pkg files might be tar-based)
					tar -xf ${packageFile} 2>/dev/null || {
						echo "Unable to extract package: no suitable extraction tool found"
						exit 1
					}
				fi
			fi

			# Find and extract payload files (usually gzipped cpio archives)
			find . -name "Payload" -o -name "*.pax.gz" -o -name "*.cpio.gz" | while read payload; do
				if [ -f "$payload" ]; then
					# Create extraction directory for this payload
					payload_dir=$(dirname "$payload")/extracted
					mkdir -p "$payload_dir"
					cd "$payload_dir"

					# Extract the payload
					if file "$payload" | grep -q "gzip"; then
						gunzip -dc "$payload" | cpio -i 2>/dev/null || continue
					elif file "$payload" | grep -q "cpio"; then
						cpio -i < "$payload" 2>/dev/null || continue
					else
						continue
					fi

					# Copy binaries if found
					for binary in ${binaries.join(" ")}; do
						if [ -f "usr/local/bin/$binary" ]; then
							cp "usr/local/bin/$binary" $OUTPUT/bin/
							chmod +x "$OUTPUT/bin/$binary"
						elif [ -f "usr/bin/$binary" ]; then
							cp "usr/bin/$binary" $OUTPUT/bin/
							chmod +x "$OUTPUT/bin/$binary"
						fi
					done

					# Copy library if found
					if [ -f "usr/local/lib/libfdb_c.dylib" ]; then
						cp "usr/local/lib/libfdb_c.dylib" $OUTPUT/lib/
					elif [ -f "usr/lib/libfdb_c.dylib" ]; then
						cp "usr/lib/libfdb_c.dylib" $OUTPUT/lib/
					fi

					cd "$WORK_DIR"
				fi
			done

			# Clean up
			rm -rf $WORK_DIR
			`.then(tg.Directory.expect);
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
