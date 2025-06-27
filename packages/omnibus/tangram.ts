import * as std from "std" with { path: "../std" };
import * as bun from "bun" with { path: "../bun" };
import * as nats from "nats-server" with { path: "../nats-server" };
import * as fdb from "foundationdb" with { path: "../foundationdb" };
import * as tangram from "tangram" with { path: "../../../tangram" };
import * as postgresql from "postgresql" with { path: "../postgresql" };

import entrypointScript from "./entrypoint.ts" with { type: "file" };

export default async () => {
	// Produce the env.
	const env = await std.env.arg(
		bun.self(),
		nats.build(),
		postgresql.build(),
		fdb.build(),
		tangram.build({ foundationdb: true }),
	);

	// Wrap the entrypoint.
	const entrypoint = std.wrap(entrypointScript, { env });

	// Build the image.
	return await std.image(env, {
		users: ["postgres"],
	});
};

export const databaseImage = async () => {
	const env = std.env(postgresql.build());
	const script = `
			if [ ! -f /data/database/postgresql.conf ]; then
				initdb -D /data/database
				echo "local   all   all                     trust" > /data/database/pg_hba.conf
				echo "host    all   all   127.0.0.1/32      trust" >> /data/database/pg_hba.conf
				echo "host    all   all   ::1/128           trust" >> /data/database/pg_hba.conf
			fi
			postgres -D /data/database
	`;
	const image = std.image(env, {
		cmd: ["bash", "-c", script],
		user: "postgres",
	});
	return image;
};

export const messengerImage = async () => {
	const natsConfig = {
		http: "0.0.0.0:8222",
		jetstream: {
			store_dir: "/data",
		},
		listen: "0.0.0.0:4222",
		server_name: "localhost",
	};
	const configFile = await tg.file(tg.encoding.json.encode(natsConfig));
	await configFile.store();
	console.log(configFile.id);
	const rootFs = await tg.directory({
		config: {
			nats: configFile,
		},
		data: {},
	});

	const env = std.env(nats.build());
	const image = std.image(env, {
		cmd: ["bash", "-c", "nats-server -c /config/nats"],
		layers: [rootFs],
	});
	return image;
};
