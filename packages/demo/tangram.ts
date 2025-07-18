import * as nodejs from "nodejs" with { local: "../nodejs" };
import * as postgresql from "postgresql" with { local: "../postgresql" };
import * as ripgrep from "ripgrep" with { local: "../ripgrep" };
import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

export const metadata = {
	name: "demo",
};

type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
};

export const image = (arg?: Arg) => std.image(env(arg), { cmd: ["bash"] });

export const env = (arg?: Arg) => std.env(...packages(arg));

export const executable = (arg?: Arg) => std.wrap(script, { env: env(arg) });

const packages = (arg?: Arg) => {
	const arg_ = arg ?? {};
	return [nodejs.toolchain(arg_), postgresql.build(arg_), ripgrep.build(arg_)];
};

export const script = `
	echo "Node.js version: $(node --version)" | tee -a $OUTPUT
	echo "ripgrep version: $(rg --version)" | tee -a $OUTPUT
	echo "PostgreSQL version: $(psql --version)" | tee -a $OUTPUT
`;

export const test = async () => {
	return await $`${executable()}`.then(tg.File.expect);
};

export const testGccMusl = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error("Musl-based SDKs are only available on Linux");
	}
	const muslHost = std.triple.create(host, { environment: "musl" });
	return $`${executable({ build: muslHost, host: muslHost })}`;
};

export const testGccMold = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error("Mold SDKs are only available on Linux");
	}
	return $`${executable({ sdk: { linker: "mold" } })}`;
};

export const testLlvm = async () => {
	// NOTE - this is the default on macOS.
	return $`${executable({ sdk: { toolchain: "llvm" } })}`;
};

export const testLlvmMusl = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error("Musl-based SDKs are only available on Linux");
	}
	const muslHost = std.triple.create(host, { environment: "musl" });
	return $`${executable({ host: muslHost, sdk: { toolchain: "llvm" } })}`;
};

export const testLlvmMold = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error("Mold SDKs are only available on Linux");
	}
	return await $`${executable({ sdk: { toolchain: "llvm", linker: "mold" } })}`;
};

export const testLinuxCross = async () => {
	const build = await std.triple.host();
	if (std.triple.os(build) !== "linux") {
		throw new Error("Linux cross-compilation is only available on Linux");
	}
	const detectedArch = std.triple.arch(build);
	const crossArch = detectedArch === "x86_64" ? "aarch64" : "x86_64";
	const host = std.triple.create(build, { arch: crossArch });

	return $`${executable({ build: build, host: host })}`;
};

export const testLinuxToDarwinCross = async () => {
	const build = await std.triple.host();
	if (std.triple.os(build) !== "linux") {
		throw new Error("Linux cross-compilation is only available on Linux");
	}
	const detectedArch = std.triple.arch(build);
	const host = `${detectedArch}-apple-darwin`;

	return $`
		${executable({ build: build, host: host, sdk: { toolchain: "llvm" } })}`;
};
