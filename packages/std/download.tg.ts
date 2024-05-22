export type Arg = {
	/** The expected checksum of the downloaded file. */
	checksum: tg.Checksum;
	/** The format of the file to unpack. If `true`, will infer from the URL. Default: `true`. */
	decompress?: boolean | tg.Blob.CompressionFormat | undefined;
	/** The format of the archive file to unpack. If `true`, will infer from the URL. Default: `true`. */
	extract?: boolean | tg.Artifact.ArchiveFormat | undefined;
	/** The URL to download. */
	url: string;
};

/** Wrapper around tg.download that can optionally decompress and unpack tarballs. */
export async function download(arg: Arg): Promise<tg.Artifact> {
	return await download_(arg);
}

export default download;

/** Inner definition of std.download. */
export let download_ = tg.target(async (arg: Arg) => {
	let {
		checksum,
		decompress: decompress_ = true,
		extract: extract_ = true,
		url,
	} = arg;

	// Perform the download.
	let blob = await download.memoized.download(url, checksum);
	// TODO - always do an unsafe download, then verify the checksum afterward, so the download itself is still a cache hit.

	// If there's nothing to unpack, return the blob.
	if (!decompress_ && !extract_) {
		return tg.file(blob);
	}

	// Otherwise, unpack the blob.
	// If both values are given explictly, skip inferrence.
	if (typeof decompress_ !== "boolean" && typeof extract_ !== "boolean") {
		return await download.unpackBlob({
			decompress: decompress_,
			extract: extract_,
			blob,
		});
	}

	// If either or both is `true`, infer the formats from the URL and fill in the missing values.
	let formats = download.inferFormats(url);
	let decompress =
		typeof decompress_ === "boolean"
			? decompress_ === true
				? formats.decompress
				: undefined
			: decompress_;
	let extract =
		typeof extract_ === "boolean"
			? extract_ === true
				? formats.extract
				: undefined
			: extract_;
	return await download.unpackBlob({ decompress, extract, blob });
});

export namespace download {
	export type fromGitHubArg = GithubSource & {
		archiveFormat?: tg.Artifact.ArchiveFormat | undefined;
		compressionFormat?: tg.Blob.CompressionFormat | undefined;
		owner: string;
		repo: string;
		tag: string;
		checksum: tg.Checksum;
	};

	type GithubSource = GithubRelease | GithubTag;

	type GithubRelease = {
		source: "release";
		version: string;
	};

	type GithubTag = {
		source: "tag";
	};

	export let fromGithub = async (arg: fromGitHubArg) => {
		let {
			archiveFormat: extract = "tar",
			checksum,
			compressionFormat: decompress = "gz",
			owner,
			repo,
			source,
			tag,
		} = arg;

		// Build the url.
		let url = `https://github.com/${owner}/${repo}`;
		let extension = `.${extract}`;
		if (decompress !== undefined) {
			extension += `.${decompress}`;
		}

		if (source === "release") {
			tg.assert("version" in arg && arg.version !== undefined);
			let version = arg.version;
			let archive = packageArchive({
				name: repo,
				extension,
				version,
			});
			url += `/releases/download/${tag}/${archive}`;
		} else {
			url += `/archive/refs/tags/${tag}${extension}`;
		}

		// Download and unpack the archive.
		let outer = tg.Directory.expect(
			await download({
				checksum,
				decompress,
				extract,
				url,
			}),
		);
		return download.unwrapDirectory(outer);
	};

	export type FromGnuArg = {
		checksum: tg.Checksum;
		compressionFormat?: tg.Blob.CompressionFormat | undefined;
		name: string;
		version: string;
	};

	/** Download a source package hosted in the GNU FTP repository. */
	export let fromGnu = async (arg: FromGnuArg) => {
		let { checksum, compressionFormat: decompress = "gz", name, version } = arg;
		let extract = "tar" as tg.Artifact.ArchiveFormat;
		let extension = `.${extract}.${decompress}`;
		let archive = packageArchive({ extension, name, version });
		let url = gnuUrl(name, archive);

		let outer = tg.Directory.expect(
			await download({
				checksum,
				decompress,
				extract,
				url,
			}),
		);
		return download.unwrapDirectory(outer);
	};

	export let gnuUrl = (name: string, archive: string) => {
		return `https://ftp.gnu.org/gnu/${name}/${archive}`;
	};

	export type UnpackArg = {
		blob: tg.Blob;
		decompress?: tg.Blob.CompressionFormat | undefined;
		extract?: tg.Artifact.ArchiveFormat | undefined;
	};

	export let unpackBlob = async (arg: UnpackArg): Promise<tg.Artifact> => {
		let { blob, decompress, extract } = arg;
		if (decompress === undefined && extract === undefined) {
			return tg.file(blob);
		}

		// Decompress if necessary.
		if (decompress) {
			blob = await download.memoized.decompress(blob, decompress);
		}

		// Unpack if necessary.
		if (extract) {
			return download.memoized.extract(blob, extract);
		} else {
			return tg.file(blob);
		}
	};

	export type PackageNameArg = {
		name: string;
		version?: string;
	};

	/** Get the package name for a name and version. */
	export let packageName = (arg: PackageNameArg) => {
		let { name, version } = arg;
		let versionSuffix = version ? `-${version}` : "";
		return `${name}${versionSuffix}`;
	};

	export type PackageArchiveArg = {
		name: string;
		extension: string;
		version: string;
	};

	/** Get the archive name for a name, version, and optional format. */
	export let packageArchive = (arg: PackageArchiveArg) => {
		let pkgName = packageName(arg);
		return `${pkgName}${arg.extension}`;
	};

	/** Determine the archive formats from the file extension of the url. */
	export let inferFormats = (
		url: string,
	): {
		decompress?: tg.Blob.CompressionFormat;
		extract?: tg.Artifact.ArchiveFormat;
	} => {
		let decompress = undefined;
		let extract = undefined;

		let split = url.split(".");
		let last = split.pop();
		switch (last) {
			case "tar":
			case "zip":
				extract = last as tg.Artifact.ArchiveFormat;
				break;
			case "tgz":
				extract = "tar" as tg.Artifact.ArchiveFormat;
				decompress = "gz" as tg.Blob.CompressionFormat;
				break;
			case "bz2":
			case "gz":
			case "xz":
			case "zst":
			case "zstd":
				decompress = last as tg.Blob.CompressionFormat;
				let prev = split.pop();
				if (prev === "tar") {
					extract = prev as tg.Artifact.ArchiveFormat;
				}
				break;
			default:
				throw new Error(`could not infer compression format from URL: ${url}`);
		}

		if (extract === undefined && decompress === undefined) {
			return {};
		} else if (extract === undefined) {
			tg.assert(decompress !== undefined);
			return { decompress };
		} else if (decompress === undefined) {
			return { extract };
		} else {
			return { decompress, extract };
		}
	};

	/** If the given directory contains a single child directory, return the inner child. */
	export let unwrapDirectory = async (
		directory: tg.Directory,
	): Promise<tg.Directory> => {
		let iterator = directory[Symbol.asyncIterator]();
		let inner = await iterator.next();
		tg.assert(
			(await iterator.next()).done,
			"Expected the directory to contain one entry.",
		);
		let ret = inner.value.at(1);
		tg.assert(
			ret instanceof tg.Directory,
			"Expected the entry to be a directory.",
		);
		return ret;
	};

	export namespace memoized {
		// FIXME - just a file for these , not a directory.
		/** Utiltity to memoize the result of the raw `tg.download` call. */
		export let download = async (
			url: string,
			checksum: string,
		): Promise<tg.Blob> => {
			let artifactDir = tg.directory({
				"tangram.ts": tg.file(
					`export default tg.target((...args) => tg.download(...args));`,
				),
			});
			let target = await tg.target({
				host: "js",
				executable: tg.symlink(tg`${artifactDir}/tangram.ts`),
				args: ["default", url, checksum],
				env: tg.current.env(),
				lock: tg.lock(),
			});
			let blob = await target.output();
			tg.assert(blob instanceof tg.Leaf || blob instanceof tg.Branch);
			return blob;
		};

		/** Utiltity to memoize the result of the raw `tg.Blob.decompress` call. */
		export let decompress = async (
			blob: tg.Blob,
			compressionFormat: tg.Blob.CompressionFormat,
		): Promise<tg.Blob> => {
			let artifactDir = tg.directory({
				"tangram.ts": tg.file(
					`export default tg.target((...args) => tg.Blob.decompress(...args));`,
				),
			});
			let target = await tg.target({
				host: "js",
				executable: tg.symlink(tg`${artifactDir}/tangram.ts`),
				args: ["default", blob, compressionFormat],
				env: tg.current.env(),
				lock: tg.lock(),
			});
			let result = await target.output();
			tg.assert(result instanceof tg.Leaf || result instanceof tg.Branch);
			return result;
		};

		/** Utiltity to memoize the result of the raw `tg.Artifact.extract` call. */
		export let extract = async (
			blob: tg.Blob,
			format: tg.Artifact.ArchiveFormat,
		): Promise<tg.Artifact> => {
			let artifactDir = tg.directory({
				"tangram.ts": tg.file(
					`export default tg.target((...args) => tg.Artifact.extract(...args));`,
				),
			});
			let target = await tg.target({
				host: "js",
				executable: tg.symlink(tg`${artifactDir}/tangram.ts`),
				args: ["default", blob, format],
				env: tg.current.env(),
				lock: tg.lock(),
			});
			let result = await target.output();
			tg.Artifact.assert(result);
			return result;
		};
	}
}
