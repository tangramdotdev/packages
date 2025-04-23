export type Arg = download.BuildUrlArg & {
	/** The expected checksum of the downloaded file. Use "any" to allow network access without verifying the result. */
	checksum: tg.Checksum;
	/** Should the downloaded blob get decompressed?. Default: `true`. */
	decompress?: boolean;
	/** Should the downloaded blob get extracted as an archive? Default: `true`. */
	extract?: boolean;
	/** Optional list of mirror URLs to try if the primary URL fails. */
	mirrors?: Array<string>;
};

/** Wrapper around tg.download that can optionally decompress and unpack tarballs. */
export async function download(arg: Arg): Promise<tg.Artifact> {
	const {
		checksum,
		decompress = true,
		extract = true,
		mirrors = [],
		...rest
	} = arg;
	const primaryUrl = download.buildUrl(rest);
	const urls = [primaryUrl, ...mirrors];

	// Perform the download.
	let blob: tg.Blob | undefined;
	let lastError: Error | undefined;
	for (const url of urls) {
		try {
			blob = (await tg.download(url, checksum).then(tg.Blob.expect)) as tg.Blob;
		} catch (e) {
			lastError = e as Error;
			continue;
		}
	}
	if (blob === undefined) {
		throw lastError;
	}

	// Otherwise, unpack the blob.
	// If either or both is `true`, infer the formats from the URL and fill in the missing values.
	return await download.unpackBlob({ decompress, extract, blob });
}

export default download;

export namespace download {
	export type fromGitHubArg = GithubSource & {
		archiveFormat?: tg.ArchiveFormat | undefined;
		checksum: tg.Checksum;
		compression?: tg.CompressionFormat | undefined;
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
			archiveFormat = "tar",
			checksum,
			compression = "gz",
			owner,
			repo,
			source,
			tag,
		} = arg;

		// Build the url.
		let url = `https://github.com/${owner}/${repo}`;
		let extension = `.${archiveFormat}`;
		if (compression !== undefined) {
			extension += `.${compression}`;
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
				decompress: compression !== undefined,
				extract: archiveFormat !== undefined,
				url,
			}),
		);
		return download.unwrapDirectory(outer);
	};

	export type FromGnuArg = {
		checksum: tg.Checksum;
		compression?: tg.CompressionFormat | undefined;
		name: string;
		version: string;
	};

	/** Download a source package hosted in the GNU FTP repository. */
	export const fromGnu = async (arg: FromGnuArg) => {
		const { checksum, compression = "gz", name, version } = arg;
		const archiveFormat = "tar" as tg.ArchiveFormat;
		const extension = `.${archiveFormat}.${compression}`;
		const archive = packageArchive({ extension, name, version });
		const url = gnuUrl(name, archive);

		const outer = tg.Directory.expect(await download({ checksum, url }));
		return download.unwrapDirectory(outer);
	};

	export const gnuUrl = (name: string, archive: string) => {
		return `http://ftpmirror.gnu.org/gnu/${name}/${archive}`;
	};

	export type UnpackArg = {
		blob: tg.Blob;
		decompress?: boolean;
		extract?: boolean;
	};

	export const unpackBlob = async (arg: UnpackArg): Promise<tg.Artifact> => {
		let { blob, decompress, extract } = arg;

		// If extract is set, `tg.Artifact.extract` will handle both compressed and uncompressed blobs.
		if (extract) {
			return tg.extract(blob);
		}

		// If asked to decompress but not extract, decompress the blob.
		if (decompress) {
			blob = await tg.decompress(blob);
		}

		return tg.file(blob);
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
