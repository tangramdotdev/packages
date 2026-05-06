import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

/** Produce a std.sdk() consisting only of components from the bootstrap bundles, with the `ld` proxy enabled. Will not compile any utilities or toolchains. */
export async function sdk(host?: string) {
	return await tg.build(std.sdk, sdk.arg(host)).named("bootstrap sdk");
}

export namespace sdk {
	/** Produce the arg object to create a bootstrap-only SDK. */
	export const arg = async (hostArg?: string): Promise<std.sdk.Arg> => {
		const host = bootstrap.toolchainTriple(hostArg);
		const toolchain = await env(host);
		return { host, toolchain };
	};

	/** Build a thin `bin/` directory utilizing symlinks to their respective artifacts. */
	const thinBin = async (
		sources: Array<tg.Directory>,
		extras: Record<string, tg.Unresolved<tg.Artifact | undefined>> = {},
	): Promise<tg.Directory> => {
		const entries: Record<string, tg.Unresolved<tg.Artifact | undefined>> = {};
		for (const src of sources) {
			const srcEntries = await src.entries;
			if (!("bin" in srcEntries)) continue;
			const bin = tg.Directory.expect(srcEntries.bin);
			for (const [name, entry] of Object.entries(await bin.entries)) {
				entries[name] =
					entry instanceof tg.Symlink
						? entry
						: tg.symlink(tg`${src}/bin/${name}`);
			}
		}
		return tg.directory({ ...entries, ...extras });
	};

	/** Get the bootstrap toolchain directory, with darwin gcc/g++ symlink fixups applied. Does not include utils. */
	export const toolchain = async (hostArg: string) => {
		const host = hostArg ?? std.triple.host();
		const raw = await bootstrap.toolchain(host);
		if (std.triple.os(host) !== "darwin") return raw;
		const overlay: Record<string, tg.Unresolved<tg.Artifact>> = {
			bin: await thinBin([raw], {
				gcc: tg.symlink("clang"),
				"g++": tg.symlink("clang++"),
			}),
		};
		for (const name of Object.keys(await raw.entries)) {
			if (name !== "bin") overlay[name] = tg.symlink(tg`${raw}/${name}`);
		}
		return tg.directory(overlay);
	};

	/** Get a build environment containing only the components from the pre-built bootstrap artifacts with no proxies. Instead of using this env directly, consider using `std.sdk({ bootstrapMode: true })`, which can optionally include the linker and/or cc proxies. */
	export const env = async (hostArg: string) => {
		const t = await toolchain(hostArg);
		const bootstrapHost = bootstrap.toolchainTriple(
			hostArg ?? std.triple.host(),
		);
		const utils = await prepareBootstrapUtils(bootstrapHost);
		const tEntries = await t.entries;
		const utilsEntries = await utils.entries;
		const overlay: Record<string, tg.Unresolved<tg.Artifact>> = {
			bin: await thinBin([t, utils]),
		};
		for (const name of Object.keys(tEntries)) {
			if (name === "bin" || name in utilsEntries) continue;
			overlay[name] = tg.symlink(tg`${t}/${name}`);
		}
		for (const [name, uEntry] of Object.entries(utilsEntries)) {
			if (name === "bin") continue;
			const tEntry = tEntries[name];
			if (tEntry instanceof tg.Directory && uEntry instanceof tg.Directory) {
				overlay[name] = await tg.directory(tEntry, uEntry);
			} else {
				overlay[name] = tg.symlink(tg`${utils}/${name}`);
			}
		}
		return tg.directory(overlay);
	};

	/** Get the busybox/toybox utils artifact from the bootstrap. */
	export const prepareBootstrapUtils = async (hostArg?: string) => {
		const host = hostArg ?? std.triple.host();
		return bootstrap.utils(host);
	};
}

export const test = async () => {
	const sdkEnv = await sdk();
	const arg = await sdk.arg();
	await std.sdk.assertValid(sdkEnv, arg);
	return sdkEnv;
};
