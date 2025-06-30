import * as std from "std" with { local: "../std" };
import * as bash from "bash" with { local: "../bash" };
import * as bun from "bun" with { local: "../bun" };
import * as coreutils from "coreutils" with { local: "../coreutils" };
import * as nats from "nats-server" with { local: "../nats-server" };
import * as nushell from "nushell" with { local: "../nushell" };
import * as fdb from "foundationdb" with { local: "../foundationdb" };
import * as tangram from "tangram" with { local: "../../../tangram" };
import * as postgresql from "postgresql" with { local: "../postgresql" };
import * as sudo from "sudo" with { local: "../sudo" };

import entrypointScript from "./entrypoint.nu" with { type: "file" };
import testEntrypointScript from "./testEntrypoint.ts" with { type: "file" };

export type Arg = {
	build?: string;
	host?: string;
	sdk?: std.sdk.Arg;
};

export const build = async (unresolvedArg?: tg.Unresolved<Arg>) => {
	const arg = await tg.resolve(unresolvedArg);
	let host = arg?.host ?? (await std.triple.host());
	let build = arg?.build ?? host;
	const sdk = arg?.sdk;

	// Produce the env.
	const bunArtifact = await bun.self({ host }); // FIXME - not necessary?
	const sudoArtifact = await sudo.build({ build, host });
	const sudoEtc = await sudoArtifact.get("etc").then(tg.Directory.expect);
	const env = await std.env(
		bunArtifact,
		nats.build({ build, host, sdk }),
		postgresql.build({ build, host, sdk }),
		fdb.build({ build, host }),
		nushell.build({ build, host, sdk }),
		tangram.cloud({ build, host }), // FIXME - sdk for tangram.
		sudoArtifact,
	);

	// Build the image.
	return await std.image(env, {
		cmd: ["bun", "run", "/script"],
		layers: [
			tg.directory({ etc: sudoEtc }),
			tg.directory({ script: entrypointScript }),
		],
		users: ["root:root:0:0", "postgres"],
	});
};

export default build;

export const cross = async () =>
	build({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
	});

export const testBun = async () => {
	const bunArtifact = await bun.self();
	const env = await std.env(
		bash.build(),
		bunArtifact,
		coreutils.build(),
		nats.build(),
		{
			NAME: "Tangram",
		},
	);
	return await std.image(env, {
		cmd: ["bun", "run", "/script"],
		layers: [tg.directory({ script: testEntrypointScript })],
	});
};

export const llvm = () => build({ sdk: { toolchain: "llvm" } });
export const crossGcc = () =>
	build({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
	});
export const crossLlvm = () =>
	build({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
		sdk: { toolchain: "llvm" },
	});
