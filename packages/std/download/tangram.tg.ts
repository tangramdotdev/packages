export let metadata = {
	name: "download",
	version: "0.0.0",
};

export type Arg = {
	/** The expected checksum of the downloaded file. */
	checksum: tg.Checksum;
	/** The format of the file to unpack. If `true`, will infer from the URL. Default: `true`. */
	decompress?: boolean | tg.Blob.CompressionFormat;
	/** The format of the archive file to unpack. If `true`, will infer from the URL. Default: `true`. */
	extract?: boolean | tg.Artifact.ArchiveFormat;
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
	let blob = await tg.download(url, checksum);

	// If there's notthing to unpack, return the blob.
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
		archiveFormat?: tg.Artifact.ArchiveFormat;
		compressionFormat?: tg.Blob.CompressionFormat;
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
		compressionFormat?: tg.Blob.CompressionFormat;
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
		decompress?: tg.Blob.CompressionFormat;
		extract?: tg.Artifact.ArchiveFormat;
	};

	export let unpackBlob = async (arg: UnpackArg): Promise<tg.Artifact> => {
		let { blob, decompress, extract } = arg;
		if (decompress === undefined && extract === undefined) {
			return tg.file(blob);
		}

		// Decompress if necessary.
		if (decompress) {
			blob = await blob.decompress(decompress);
		}

		// Unpack if necessary.
		if (extract) {
			return blob.extract(extract);
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
		return { decompress, extract };
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
		tg.assert(tg.Directory.is(ret), "Expected the entry to be a directory.");
		return ret;
	};
}
