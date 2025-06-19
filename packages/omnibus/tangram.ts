import * as std from "std" with { path: "../std" };
import * as curl from "curl" with { path: "../curl" };
import * as bun from "bun" with { path: "../bun" };
import * as nats from "nats-server" with { path: "../nats-server" };
import * as fdb from "foundationdb" with { path: "../foundationdb" };
import * as postgresql from "postgresql" with { path: "../postgresql" };
// TODO - tangram!

import entrypoint from "./entrypoint.ts" with { type: "file" };

export default async () => {
	const bunArtifact = await bun.self();
	const env = await std.env.arg(
		curl.build(),
		bunArtifact,
		nats.build(),
		postgresql.build(),
		fdb.build(),
	);
	// Create rootfs.
	const rootFs = await tg.directory({
		root: {},
		data: {},
	});

	// Wrap entrypoint.

	return await std.image(env, {
		workdir: "/root",
	});
};
