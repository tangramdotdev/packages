import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import bindgen from "bindgen" with { local: "../bindgen.tg.ts" };
import * as gn from "gn" with { local: "../gn.tg.ts" };
import ninja from "ninja" with { local: "../ninja.tg.ts" };
import python from "python" with { local: "../python" };
import * as rust from "rust" with { local: "../rust" };

export const metadata = {
	name: "rusty_v8",
	version: "146.0.0",
};

// Pinned commit from Cargo.lock.
const rustyV8Commit = "8ca8740070be6d7d5c9def27815ed1e2b84c2217";

// Submodule commits pinned from `git submodule status`.
const submodules: Record<string, { commit: string; url: string }> = {
	v8: {
		commit: "b12260267f9e6b53cf9dccca0e9eda8d67ddb901",
		url: "https://github.com/denoland/v8",
	},
	build: {
		commit: "8fbb331a68c597851e2e91de6e08a06baa3d719b",
		url: "https://github.com/denoland/chromium_build",
	},
	buildtools: {
		commit: "6a18683f555b4ac8b05ac8395c29c84483ac9588",
		url: "https://chromium.googlesource.com/chromium/src/buildtools",
	},
	"tools/clang": {
		commit: "d651bc848c45c945ecbc0c1a372b0b781e47c991",
		url: "https://chromium.googlesource.com/chromium/src/tools/clang",
	},
	"third_party/icu": {
		commit: "a86a32e67b8d1384b33f8fa48c83a6079b86f8cd",
		url: "https://chromium.googlesource.com/chromium/deps/icu",
	},
	"third_party/abseil-cpp": {
		commit: "6d5ac0f7d3f0af5d13b78044fc31c793aa3549f8",
		url: "https://chromium.googlesource.com/chromium/src/third_party/abseil-cpp",
	},
	"third_party/libc++/src": {
		commit: "7ab65651aed6802d2599dcb7a73b1f82d5179d05",
		url: "https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libcxx",
	},
	"third_party/libc++abi/src": {
		commit: "8f11bb1d4438d0239d0dfc1bd9456a9f31629dda",
		url: "https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libcxxabi",
	},
	"third_party/libunwind/src": {
		commit: "ba19d93d6d4f467fba11ff20fe2fc7c056f79345",
		url: "https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libunwind",
	},
	"third_party/jinja2": {
		commit: "c3027d884967773057bf74b957e3fea87e5df4d7",
		url: "https://chromium.googlesource.com/chromium/src/third_party/jinja2",
	},
	"third_party/markupsafe": {
		commit: "4256084ae14175d38a3ff7d739dca83ae49ccec6",
		url: "https://chromium.googlesource.com/chromium/src/third_party/markupsafe",
	},
	"third_party/fp16/src": {
		commit: "3d2de1816307bac63c16a297e8c4dc501b4076df",
		url: "https://github.com/Maratyszcza/FP16",
	},
	"third_party/fast_float/src": {
		commit: "cb1d42aaa1e14b09e1452cfdef373d051b8c02a4",
		url: "https://github.com/fastfloat/fast_float",
	},
	"third_party/llvm-libc/src": {
		commit: "e81e859cfb7e78e70a58c3bfce859c509f45e1da",
		url: "https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libc",
	},
	"third_party/simdutf": {
		commit: "93b35aec29256f705c97f675fe4623578bd7a395",
		url: "https://chromium.googlesource.com/chromium/src/third_party/simdutf",
	},
	"third_party/highway/src": {
		commit: "84379d1c73de9681b54fbe1c035a23c7bd5d272d",
		url: "https://github.com/google/highway",
	},
	"third_party/partition_alloc": {
		commit: "936619c71ecb17c0e2482cf86be3f3f417b2f683",
		url: "https://chromium.googlesource.com/chromium/src/base/allocator/partition_allocator",
	},
	"third_party/dragonbox/src": {
		commit: "beeeef91cf6fef89a4d4ba5e95d47ca64ccb3a44",
		url: "https://github.com/jk-jeon/dragonbox",
	},
	"third_party/rust": {
		commit: "30eb036e9b2f181dda31bde6f20d2a4983e380b9",
		url: "https://chromium.googlesource.com/chromium/src/third_party/rust",
	},
};

/** Download and assemble the full rusty_v8 source tree with all submodules. */
export const source = async (): Promise<tg.Directory> => {
	// Download the main rusty_v8 repo.
	const mainSource = await downloadGithubArchive(
		"tangramdotdev",
		"rusty_v8",
		rustyV8Commit,
	);

	// Download all submodules in parallel.
	const submoduleEntries = await Promise.all(
		Object.entries(submodules).map(async ([path, { commit, url }]) => {
			const dir = await downloadSubmodule(url, commit);
			return [path, dir] as const;
		}),
	);

	// Assemble the full source tree by layering each submodule on top.
	let result = mainSource;
	for (const [path, dir] of submoduleEntries) {
		result = await tg.directory(result, pathToNestedDir(path, dir));
	}

	return result;
};

/** Download a GitHub archive and unwrap the top-level directory. */
const downloadGithubArchive = async (
	owner: string,
	repo: string,
	commit: string,
): Promise<tg.Directory> => {
	const checksum = "sha256:any" as tg.Checksum;
	const url = `https://github.com/${owner}/${repo}/archive/${commit}.tar.gz`;
	return await std
		.download({ checksum, url, mode: "extract" })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

/** Download a submodule archive. GitHub archives have a top-level directory that needs unwrapping. googlesource archives are flat. */
const downloadSubmodule = async (
	url: string,
	commit: string,
): Promise<tg.Directory> => {
	const checksum = "sha256:any" as tg.Checksum;
	if (url.startsWith("https://github.com")) {
		const archiveUrl = `${url}/archive/${commit}.tar.gz`;
		return await std
			.download({ checksum, url: archiveUrl, mode: "extract" })
			.then(tg.Directory.expect)
			.then(std.directory.unwrap);
	} else {
		// googlesource archives are flat (no top-level directory).
		const archiveUrl = `${url}/+archive/${commit}.tar.gz`;
		return await std
			.download({ checksum, url: archiveUrl, mode: "extract" })
			.then(tg.Directory.expect);
	}
};

/** Convert a slash-separated path into a nested directory object for use with tg.directory(). */
const pathToNestedDir = (
	path: string,
	value: tg.Directory,
): Record<string, tg.Unresolved<tg.Artifact>> => {
	const parts = path.split("/");
	let result: Record<string, tg.Unresolved<tg.Artifact>> = {
		[parts[parts.length - 1]!]: value,
	};
	for (let i = parts.length - 2; i >= 0; i--) {
		result = { [parts[i]!]: tg.directory(result) };
	}
	return result;
};

export type Arg = std.args.BasePackageArg;

/** Build librusty_v8.a.gz from source. Returns a tg.File containing the gzipped static library. */
export const build = async (...args: std.Args<Arg>): Promise<tg.File> => {
	const {
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceDir = source_ ?? (await source());

	// Determine target_cpu for GN.
	const arch = std.triple.arch(host);
	const targetCpu = arch === "aarch64" ? "arm64" : "x64";

	// V8 requires clang via the LLVM SDK, plus Rust and bindgen.
	const llvmSdk = std.sdk({
		host: build,
		target: host,
		toolchain: "llvm",
		...sdk,
	});
	const rustToolchain = rust.self({ host: build, profile: "default" });
	const bindgenPkg = bindgen({ host: build });
	const env = std.env.arg(
		llvmSdk,
		rustToolchain,
		bindgenPkg,
		gn.build({ host: build }),
		ninja({ host: build }),
		python({ host: build }),
		env_,
	);

	// Build V8 using GN and ninja.
	return await $`
		set -eux

		# Copy source tree to a writable location.
		cp -R ${sourceDir}/. src
		chmod -R u+w src
		cd src

		# Find the clang base path from the SDK.
		CLANG_BIN=$(command -v clang)
		CLANG_BASE_PATH=$(dirname $(dirname "$CLANG_BIN"))

		# Set up third_party/rust-toolchain from our Rust sysroot.
		rm -rf third_party/rust-toolchain
		cp -R ${rustToolchain} third_party/rust-toolchain
		chmod -R u+w third_party/rust-toolchain

		# Add bindgen to the toolchain directory.
		cp ${bindgenPkg}/bin/bindgen third_party/rust-toolchain/bin/bindgen

		# Copy libclang.so and its dependency libc++.so into the Rust toolchain so that bindgen can find them.
		# libc++.so lives in the per-target runtime directory.
		cp "$CLANG_BASE_PATH"/lib/libclang.so* third_party/rust-toolchain/lib/
		cp "$CLANG_BASE_PATH"/lib/${host}/libc++.so* third_party/rust-toolchain/lib/

		# Create the VERSION file that GN expects.
		RUSTC_VERSION=$(third_party/rust-toolchain/bin/rustc -V)
		RUST_VERSION=$(echo "$RUSTC_VERSION" | sed 's/rustc //')
		echo "$RUST_VERSION" > third_party/rust-toolchain/VERSION

		# Write GN args.
		mkdir -p gn_out
		cat > gn_out/args.gn << GNARGS
		is_debug = false
		is_clang = true
		clang_base_path = "$CLANG_BASE_PATH"
		rust_sysroot_absolute = "$PWD/third_party/rust-toolchain"
		rustc_version = "$RUSTC_VERSION"
		use_sysroot = false
		use_custom_libcxx = false
		v8_enable_sandbox = false
		v8_enable_pointer_compression = false
		treat_warnings_as_errors = false
		use_glib = false
		clang_version = "22"
		target_cpu = "${targetCpu}"
		added_rust_stdlib_libs = ["adler2"]
		removed_rust_stdlib_libs = ["adler"]
		GNARGS

		# Generate build files and build.
		gn gen gn_out
		ninja -C gn_out rusty_v8

		# Compress and output the static library.
		gzip -c gn_out/obj/librusty_v8.a > ${tg.output}
	`
		.env(env)
		.then(tg.File.expect);
};

export default build;
