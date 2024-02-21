import nodejs from "tg:nodejs" with { path: "../nodejs" };
import postgresql from "tg:postgresql" with { path: "../postgresql" };
import ripgrep from "tg:ripgrep" with { path: "../ripgrep" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "demo",
};

type Arg = {
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
};

export let image = tg.target((arg?: Arg) =>
	std.image(env(arg), { cmd: ["bash"] }),
);

export let env = tg.target((arg?: Arg) => std.env(...packages(arg)));

export let executable = tg.target((arg?: Arg) =>
	std.wrap(script, { env: env(arg) }),
);

let packages = (arg?: Arg) => {
	return [nodejs(arg), postgresql(arg), ripgrep(arg)];
};

export let script = `
	echo "Node.js version: $(node --version)" | tee -a $OUTPUT
	echo "ripgrep version: $(rg --version)" | tee -a $OUTPUT
	echo "PostgreSQL version: $(psql --version)" | tee -a $OUTPUT
`;

export let test = tg.target(() => {
	return std.build(executable());
});

export let testGccMusl = tg.target(async () => {
	let host = await tg.Triple.host();
	if (host.os !== "linux") {
		throw new Error("Musl-based SDKs are only available on Linux");
	}
	let muslHost = tg.triple({ ...host, environment: "musl" });
	return std.build(executable({ build: muslHost, host: muslHost }));
});

export let testGccMold = tg.target(async () => {
	let host = await tg.Triple.host();
	if (host.os !== "linux") {
		throw new Error("Mold SDKs are only available on Linux");
	}
	return std.build(executable({ sdk: { linker: "mold" } }));
});

export let testLlvm = tg.target(async () => {
	// NOTE - this is the default on macOS.
	return std.build(executable({ sdk: { toolchain: "llvm" } }));
});

export let testLlvmMusl = tg.target(async () => {
	let host = await tg.Triple.host();
	if (host.os !== "linux") {
		throw new Error("Musl-based SDKs are only available on Linux");
	}
	let muslHost = tg.triple({ ...host, environment: "musl" });
	return std.build(executable({ host: muslHost, sdk: { toolchain: "llvm" } }));
});

export let testLlvmMold = tg.target(async () => {
	let host = await tg.Triple.host();
	if (host.os !== "linux") {
		throw new Error("Mold SDKs are only available on Linux");
	}
	return std.build(executable({ sdk: { toolchain: "llvm", linker: "mold" } }));
});

export let testLinuxCross = tg.target(async () => {
	let build = await tg.Triple.host();
	if (build.os !== "linux") {
		throw new Error("Linux cross-compilation is only available on Linux");
	}
	let detectedArch = build.arch;
	let crossArch: tg.Triple.Arch =
		detectedArch === "x86_64" ? "aarch64" : "x86_64";
	let host = tg.triple({ ...build, arch: crossArch });

	return std.build(executable({ build: build, host: host }));
});

export let testLinuxToDarwinCross = tg.target(async () => {
	let build = await tg.Triple.host();
	if (build.os !== "linux") {
		throw new Error("Linux cross-compilation is only available on Linux");
	}
	let detectedArch = build.arch;
	let host = tg.triple(`${detectedArch}-apple-darwin`);

	return std.build(
		executable({ build: build, host: host, sdk: { toolchain: "llvm" } }),
	);
});
