export type Arg = download.BuildUrlArg & {
	/** The expected checksum of the downloaded file. Use "any" to allow network access without verifying the result. */
	checksum: tg.Checksum;
	/** The format of the file to unpack. If `true`, will infer from the URL. Default: `true`. */
	decompress?: boolean | tg.Blob.CompressionFormat | undefined;
	/** The format of the archive file to unpack. If `true`, will infer from the URL. Default: `true`. */
	extract?: boolean | tg.Artifact.ArchiveFormat | undefined;
	/** Optional list of mirror URLs to try if the primary URL fails. */
	mirrors?: Array<string>;
};

/** Wrapper around tg.download that can optionally decompress and unpack tarballs. */
export async function download(arg: Arg): Promise<tg.Artifact> {
	const {
		checksum,
		decompress: decompress_ = true,
		extract: extract_ = true,
		mirrors = [],
		...rest
	} = arg;
	const primaryUrl = download.buildUrl(rest);
	const urls = [primaryUrl, ...mirrors];

	// Perform the download.
	let blob: tg.Blob | undefined;
	for (const url of urls) {
		try {
			blob = await tg.download(url, checksum);
		} catch (e) {
			console.log(`error downloading from ${url}: ${JSON.stringify(e)}`);
			continue;
		}
	}
	tg.assert(blob !== undefined, "unable to download blob");

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
	const formats = download.inferFormats(primaryUrl);
	const decompress =
		typeof decompress_ === "boolean"
			? decompress_ === true
				? formats.decompress
				: undefined
			: decompress_;
	const extract =
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

	export const fromGithub = async (arg: fromGitHubArg) => {
		const {
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
			const version = arg.version;
			const archive = packageArchive({
				name: repo,
				extension,
				version,
			});
			url += `/releases/download/${tag}/${archive}`;
		} else {
			url += `/archive/refs/tags/${tag}${extension}`;
		}

		// Download and unpack the archive.
		const outer = tg.Directory.expect(
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
	export const fromGnu = async (arg: FromGnuArg) => {
		const {
			checksum,
			compressionFormat: decompress = "gz",
			name,
			version,
		} = arg;
		const extract = "tar" as tg.Artifact.ArchiveFormat;
		const extension = `.${extract}.${decompress}`;
		const archive = packageArchive({ extension, name, version });
		const url = gnuUrl(name, archive);

		const outer = tg.Directory.expect(
			await download({
				checksum,
				decompress,
				extract,
				url,
			}),
		);
		return download.unwrapDirectory(outer);
	};

	export const gnuUrl = (name: string, archive: string) => {
		return `https://ftp.gnu.org/gnu/${name}/${archive}`;
	};

	export type UnpackArg = {
		blob: tg.Blob;
		decompress?: tg.Blob.CompressionFormat | undefined;
		extract?: tg.Artifact.ArchiveFormat | undefined;
	};

	export const unpackBlob = async (arg: UnpackArg): Promise<tg.Artifact> => {
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

	export type BuildUrlArg =
		| (PackageArchiveArg & {
				base: string;
		  })
		| { url: string };

	/** Build a URL from one of these object shapes, combining a packageArchive with a base URL:
	 *
	 * 1. `${base}/${name}(-${version})?${extension}`
	 * 2. `${base}/${packageName}${extension}`
	 * 3. `${base}/${packageArchive}`
	 * 4. `${url}`
	 */
	export const buildUrl = (arg: BuildUrlArg): string => {
		if ("url" in arg) {
			return arg.url;
		}
		const { base, ...rest } = arg;
		return `${base}/${packageArchive(rest)}`;
	};

	export type PackageArchiveArg =
		| (PackageNameArg & {
				extension: string;
		  })
		| { packageArchive: string };

	/** Combine a packageName with an extension. */
	export const packageArchive = (arg: PackageArchiveArg) => {
		if ("packageArchive" in arg) {
			return arg.packageArchive;
		}
		const { extension, ...rest } = arg;
		return `${packageName(rest)}${extension}`;
	};

	export type PackageNameArg =
		| {
				name: string;
				version?: string;
		  }
		| { packageName: string };

	/** Get the package name string for a name and optional version. */
	export const packageName = (arg: PackageNameArg) =>
		"packageName" in arg
			? arg.packageName
			: `${arg.name}${arg.version ? `-${arg.version}` : ""}`;

	/** Determine the archive formats from the file extension of the url. */
	export const inferFormats = (
		url: string,
	): {
		decompress?: tg.Blob.CompressionFormat;
		extract?: tg.Artifact.ArchiveFormat;
	} => {
		let decompress: tg.Blob.CompressionFormat | undefined = undefined;
		let extract: tg.Artifact.ArchiveFormat | undefined = undefined;

		const split = url.split(".");
		const last = split.pop();
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
				const prev = split.pop();
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
	export const unwrapDirectory = async (
		directory: tg.Directory,
	): Promise<tg.Directory> => {
		const iterator = directory[Symbol.asyncIterator]();
		const inner = await iterator.next();
		tg.assert(
			(await iterator.next()).done,
			"Expected the directory to contain one entry.",
		);
		const ret = inner.value.at(1);
		tg.assert(
			ret instanceof tg.Directory,
			"Expected the entry to be a directory.",
		);
		return ret;
	};
}

export const test = tg.command(async () => {
	return await Promise.all([testTgDownload(), testStdDownload()]);
});

export const testTgDownload = tg.command(async () => {
	return await tg.download(
		"https://github.com/tangramdotdev/bootstrap/releases/download/v2024.06.20/dash_universal_darwin.tar.zst",
		"any",
	);
});

export const testStdDownload = tg.command(async () => {
	return await download({
		url: "https://github.com/tangramdotdev/bootstrap/releases/download/v2024.06.20/dash_universal_darwin.tar.zst",
		checksum: "any",
	});
});
