export type Arg = (download.BuildUrlArg | { url: string }) & {
	/** The expected checksum of the downloaded file. Use "unsafe" to allow network access without verifying the result. */
	checksum: tg.Checksum;
	/** The format of the file to unpack. If `true`, will infer from the URL. Default: `true`. */
	decompress?: boolean | tg.Blob.CompressionFormat | undefined;
	/** The format of the archive file to unpack. If `true`, will infer from the URL. Default: `true`. */
	extract?: boolean | tg.Artifact.ArchiveFormat | undefined;
};

/** Wrapper around tg.download that can optionally decompress and unpack tarballs. */
export async function download(arg: Arg): Promise<tg.Artifact> {
	let {
		checksum,
		decompress: decompress_ = true,
		extract: extract_ = true,
		...rest
	} = arg;
	let url = "url" in rest ? rest.url : download.buildUrl(rest);

	// Perform the download.
	let blob = await tg.download(url, checksum);

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
}

export default download;

export namespace download {
	export type fromGitHubArg = GithubSource & {
		archiveFormat?: tg.Artifact.ArchiveFormat | undefined;
		checksum: tg.Checksum;
		compressionFormat?: tg.Blob.CompressionFormat | undefined;
		owner: string;
		repo: string;
		tag: string;
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
			blob = await tg.Blob.decompress(blob, decompress);
		}

		// Unpack if necessary.
		if (extract) {
			return tg.Artifact.extract(blob, extract);
		} else {
			return tg.file(blob);
		}
	};

	export type BuildUrlArg = (PackageArchiveArg | { packageArchive: string }) & {
		base: string;
	};

	/** Build a URL from one of three forms, combining a packageArchive with a base URL:
	 *
	 * 1. `${base}/${name}(-${version})?${extension}`
	 * 2. `${base}/${packageName}${extension}`
	 * 3. `${base}/${packageArchive}`
	 */
	export let buildUrl = (arg: BuildUrlArg): string => {
		let { base, ...rest } = arg;
		let archive =
			"packageArchive" in rest ? rest.packageArchive : packageArchive(rest);
		return `${base}/${archive}`;
	};

	export type PackageArchiveArg = (PackageNameArg | { packageName: string }) & {
		extension: string;
	};

	/** Combine a packageName with an extension. */
	export let packageArchive = (arg: PackageArchiveArg) => {
		let { extension, ...rest } = arg;
		let pkgName = "packageName" in rest ? rest.packageName : packageName(rest);
		return `${pkgName}${extension}`;
	};

	export type PackageNameArg = {
		name: string;
		version?: string;
	};

	/** Get the package name string for a name and optional version. */
	export let packageName = (arg: PackageNameArg) =>
		`${arg.name}${arg.version ? `-${arg.version}` : ""}`;

	/** Determine the archive formats from the file extension of the url. */
	export let inferFormats = (
		url: string,
	): {
		decompress?: tg.Blob.CompressionFormat;
		extract?: tg.Artifact.ArchiveFormat;
	} => {
		let decompress: tg.Blob.CompressionFormat | undefined = undefined;
		let extract: tg.Artifact.ArchiveFormat | undefined = undefined;

		let split = url.split(".");
		let last = split.pop();
		switch (last) {
			case "tar":
			case "zip":
				extract = last;
				break;
			case "tgz":
				extract = "tar";
				decompress = "gz";
				break;
			case "bz2":
			case "gz":
			case "xz":
			case "zst":
			case "zstd":
				// Coerce `"zstd"` to `"zst"`.
				decompress = last === "zstd" ? "zst" : last;
				let prev = split.pop();
				if (prev === "tar") {
					extract = prev;
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
}
