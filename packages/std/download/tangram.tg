export let metadata = {
	name: "download",
};

export type Arg = {
	checksum: tg.Checksum;
	unpackFormat?: download.UnpackFormat;
	url: string;
};

/** Wrapper around tg.download that can optionally decompress and unpack tarballs. */
export async function download(arg: Arg): Promise<tg.Artifact> {
	return await download_(arg);
}

export default download;

export let download_ = tg.target(async (arg: Arg) => {
	let blob = await tg.download(arg.url, arg.checksum);
	return await download.unpackBlob(blob, arg.unpackFormat);
});

export namespace download {
	export type fromGitHubArg = {
		checksum: tg.Checksum;
		compressionFormat?: tg.Blob.CompressionFormat;
		/** Set to "true" to download from a tagged release. If false, will download the repo at the given tag. */
		release?: boolean;
		owner: string;
		repo: string;
		tag: string;
		version: string;
	};

	export let fromGithub = async (arg: fromGitHubArg) => {
		let archiveFormat = ".tar" as const;
		let compressionFormat = arg.compressionFormat ?? (".gz" as const);
		let unpackFormat = `${archiveFormat}${compressionFormat}` as const;
		let url = githubUrl({ ...arg, unpackFormat });
		let outer = tg.Directory.expect(
			await download({
				...arg,
				unpackFormat,
				url,
			}),
		);
		return unwrap(outer);
	};

	type GithubUrlArg = {
		owner: string;
		/** Set to "true" to download from a tagged release. If false, will download the repo at the given tag. */
		release?: boolean;
		repo: string;
		tag: string;
		version: string;
		unpackFormat: download.UnpackFormat;
	};

	export let githubUrl = (arg: GithubUrlArg) => {
		let { owner, repo, tag, unpackFormat, version } = arg;
		let release = arg.release ?? false;
		let base = `https://github.com/${owner}/${repo}`;
		let archive = packageArchive({
			name: repo,
			unpackFormat,
			version,
		});
		if (release) {
			return `${base}/releases/download/${tag}/${archive}`;
		} else {
			return `${base}/archive/refs/tags/${tag}${unpackFormat}`;
		}
	};

	export type FromGnuArg = {
		checksum: tg.Checksum;
		compressionFormat?: tg.Blob.CompressionFormat;
		name: string;
		version: string;
	};

	/** Download a source package hosted in the GNU FTP repository. */
	export let fromGnu = async (arg: FromGnuArg) => {
		let { checksum, name } = arg;
		let archiveFormat = ".tar" as tg.Blob.ArchiveFormat;
		let compressionFormat = arg.compressionFormat ?? ".gz";
		let unpackFormat = `${archiveFormat}${compressionFormat}` as const;
		let archive = packageArchive({ ...arg, unpackFormat });
		let url = gnuUrl(name, archive);

		let outer = tg.Directory.expect(
			await download({
				checksum,
				unpackFormat,
				url,
			}),
		);
		return unwrap(outer);
	};

	export let gnuUrl = (name: string, archive: string) => {
		return `https://ftp.gnu.org/gnu/${name}/${archive}`;
	};

	export type UnpackFormat =
		| tg.Blob.ArchiveFormat
		| tg.Blob.CompressionFormat
		| `${tg.Blob.ArchiveFormat}${tg.Blob.CompressionFormat}`;

	export let unpackBlob = async (
		blob: tg.Blob,
		format?: download.UnpackFormat,
	): Promise<tg.Artifact> => {
		if (!format) {
			return tg.file(blob);
		}
		// Separate into archive and compression formats.
		let archiveFormat: tg.Blob.ArchiveFormat | undefined;
		let compressionFormat: tg.Blob.CompressionFormat | undefined;
		let split = format.split(".");

		if (split.length === 3) {
			// We have both an archive and compression format.
			[archiveFormat, compressionFormat] = [
				`.${split[1]}` as tg.Blob.ArchiveFormat,
				`.${split[2]}` as tg.Blob.CompressionFormat,
			];
		} else if (split.length === 2) {
			// We have one or the other. Discard the first element, check the second.
			let variant = split[1];
			if (variant === "tar" || variant === "zip") {
				archiveFormat = `.${variant}` as tg.Blob.ArchiveFormat;
			} else {
				compressionFormat = `.${variant}` as tg.Blob.CompressionFormat;
			}
		} else {
			// The types should have prevented us from ever hitting this branch.
			return tg.unreachable();
		}

		// Decompress if necessary.
		if (compressionFormat) {
			blob = await blob.decompress(compressionFormat);
		}

		// Unpack if necessary.
		if (archiveFormat) {
			return blob.extract(archiveFormat);
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
		unpackFormat: download.UnpackFormat;
		version: string;
	};

	/** Get the archive name for a name, version, and optional format. */
	export let packageArchive = (arg: PackageArchiveArg) => {
		let pkgName = packageName(arg);
		return `${pkgName}${arg.unpackFormat}`;
	};
}

export let unwrap = async (directory: tg.Directory): Promise<tg.Directory> => {
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
