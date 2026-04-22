import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as gn from "gn" with { local: "../gn.tg.ts" };
import ninja from "ninja" with { local: "../ninja.tg.ts" };
import python from "python" with { local: "../python" };

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
	const mainSource = await downloadGithubArchive(
		"tangramdotdev",
		"rusty_v8",
		rustyV8Commit,
	);

	const submoduleEntries = await Promise.all(
		Object.entries(submodules).map(async ([path, { commit, url }]) => {
			const dir = await downloadSubmodule(url, commit);
			return [path, dir] as const;
		}),
	);

	let tree: Record<string, tg.Unresolved<tg.Artifact>> = {};
	for (const [path, dir] of submoduleEntries) {
		tree = setNestedPath(tree, path, dir);
	}

	return tg.directory(mainSource, tree);
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

/** GitHub archives nest under a top-level dir; googlesource archives are flat. */
const downloadSubmodule = async (
	url: string,
	commit: string,
): Promise<tg.Directory> => {
	const checksum = "sha256:any" as tg.Checksum;
	if (url.includes("github.com")) {
		const archiveUrl = `${url}/archive/${commit}.tar.gz`;
		return await std
			.download({ checksum, url: archiveUrl, mode: "extract" })
			.then(tg.Directory.expect)
			.then(std.directory.unwrap);
	} else {
		const archiveUrl = `${url}/+archive/${commit}.tar.gz`;
		return await std
			.download({ checksum, url: archiveUrl, mode: "extract" })
			.then(tg.Directory.expect);
	}
};

const setNestedPath = (
	obj: Record<string, tg.Unresolved<tg.Artifact>>,
	path: string,
	value: tg.Directory,
): Record<string, tg.Unresolved<tg.Artifact>> => {
	const parts = path.split("/");
	if (parts.length === 1) {
		obj[parts[0]!] = value;
		return obj;
	}

	let current: Record<string, tg.Unresolved<tg.Artifact>> = {};
	current[parts[parts.length - 1]!] = value;
	for (let i = parts.length - 2; i >= 0; i--) {
		const wrapper: Record<string, tg.Unresolved<tg.Artifact>> = {};
		wrapper[parts[i]!] = tg.directory(current);
		current = wrapper;
	}

	for (const [key, val] of Object.entries(current)) {
		obj[key] = val;
	}
	return obj;
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
};

/** Build librusty_v8.a.gz from source. Returns a tg.File containing the gzipped static library. */
export const build = async (...args: std.Args<Arg>): Promise<tg.File> => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
	} = await std.args.apply<Arg, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			sdk: (a, b) => std.sdk.arg(a, b),
		},
	});
	const host = host_ ?? std.triple.host();
	const buildTriple = build_ ?? host;

	const sourceDir = await source();

	const arch = std.triple.arch(host);
	const targetCpu = arch === "aarch64" ? "arm64" : "x64";

	const llvmSdk = std.sdk({
		host: buildTriple,
		target: host,
		toolchain: "llvm",
		...sdk,
	});
	const env = std.env.arg(
		llvmSdk,
		gn.build({ build: buildTriple, host: buildTriple }),
		ninja({ build: buildTriple, host: buildTriple }),
		python({ build: buildTriple, host: buildTriple }),
		env_,
	);

	const output = await $`
		set -eux

		cp -R ${sourceDir}/. src
		chmod -R u+w src
		cd src

		# GN expects a directory containing bin/clang.
		CLANG_BASE_PATH=$(dirname $(dirname $(which clang)))

		# V8 requires third_party/rust-toolchain; redirect to the build env's rustc.
		RUST_SYSROOT=$(dirname $(dirname $(which rustc))) || true
		if [ -d "$RUST_SYSROOT" ]; then
			rm -rf third_party/rust-toolchain
			ln -sf "$RUST_SYSROOT" third_party/rust-toolchain
		fi

		mkdir -p gn_out
		cat > gn_out/args.gn << 'GNARGS'
		is_debug = false
		is_clang = true
		use_sysroot = false
		use_custom_libcxx = false
		v8_enable_sandbox = false
		v8_enable_pointer_compression = false
		treat_warnings_as_errors = false
		GNARGS

		echo "clang_base_path = \"$CLANG_BASE_PATH\"" >> gn_out/args.gn
		echo "target_cpu = \"${targetCpu}\"" >> gn_out/args.gn

		if [ -d "$RUST_SYSROOT" ]; then
			echo "rust_sysroot_absolute = \"$RUST_SYSROOT\"" >> gn_out/args.gn
		fi

		gn gen gn_out
		ninja -C gn_out rusty_v8

		gzip -c gn_out/obj/librusty_v8.a > $OUTPUT
	`
		.checksum("sha256:any")
		.env(env)
		.then(tg.File.expect);

	return output;
};

export default build;
