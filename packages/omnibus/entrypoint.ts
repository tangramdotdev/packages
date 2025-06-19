#!/usr/bin/env bun

import { $ } from "bun";
import * as fs from "node:fs";

const app = process.env.FLY_APP_NAME!;
const regions = ["iad"];
const region = process.env.FLY_REGION!;
const processGroup = process.env.FLY_PROCESS_GROUP!;
const privateIp = process.env.FLY_PRIVATE_IP!;
const name = process.env.FLY_MACHINE_NAME!;

const baseConfig = {
	cleaner: false,
	database: {
		kind: "postgres",
		url: `postgres://postgres@database.process.${app}.internal`,
	},
	http: false,
	index: {
		kind: "postgres",
		url: `postgres://postgres@index.process.${app}.internal`,
	},
	indexer: false,
	messenger: {
		kind: "nats",
		url: `nats://messenger.process.${app}.internal`,
	},
	runner: false,
	store: {
		kind: "fdb",
		path: "/store.cluster",
	},
	tracing: {
		filter: "tangram_server=trace",
		format: "json",
	},
	vfs: false,
};

const storeCluster = process.env.STORE_CLUSTER;
if (storeCluster !== undefined) {
	await Bun.write("/store.cluster", storeCluster);
}

let output: { exitCode: number };
switch (processGroup) {
	case "cleaner": {
		const config = {
			...baseConfig,
			cleaner: {
				ttl: 3600,
			},
			database: {
				...baseConfig.database,
				connections: 1,
			},
		};
		await Bun.write("/config", JSON.stringify(config, null, 2));
		output = await $`tangram --config /config serve`;
		break;
	}

	case "database": {
		let script = `
			mkdir -p /data/database
			chown postgres:postgres /data/database
			if [ ! -f /data/database/postgresql.conf ]; then
				sudo -u postgres initdb -D /data/database
				echo "listen_addresses = '*'" > /data/database/postgresql.conf
				echo "max_connections = 100" >> /data/database/postgresql.conf
				echo "host all all 0.0.0.0/0 trust" > /data/database/pg_hba.conf
				echo "host all all ::/0 trust" >> /data/database/pg_hba.conf
			fi
			sudo -u postgres postgres -D /data/database
		`;
		await Bun.write("/script", script);
		output = await $`bash /script`;
		break;
	}

	case "index": {
		let script = `
			mkdir -p /data/index
			chown postgres:postgres /data/index
			if [ ! -f /data/index/postgresql.conf ]; then
				sudo -u postgres initdb -D /data/index
				echo "listen_addresses = '*'" > /data/index/postgresql.conf
				echo "max_connections = 100" >> /data/index/postgresql.conf
				echo "host all all 0.0.0.0/0 trust" > /data/index/pg_hba.conf
				echo "host all all ::/0 trust" >> /data/index/pg_hba.conf
			fi
			sudo -u postgres postgres -D /data/index
		`;
		await Bun.write("/script", script);
		output = await $`bash /script`;
		break;
	}

	case "indexer": {
		const config = {
			...baseConfig,
			database: {
				...baseConfig.database,
				connections: 1,
			},
			indexer: true,
		};
		await Bun.write("/config", JSON.stringify(config, null, 2));
		output = await $`tangram --config /config serve`;
		break;
	}

	case "messenger": {
		const config = {
			authorization: {
				default_permissions: {
					publish: ["$SYS.>"],
					subscribe: ["$SYS.>"],
				},
			},
			cluster: {
				listen: "0.0.0.0:6222",
				name: region,
				routes: [`nats://messenger.process.${region}.${app}.internal:6222`],
			},
			gateway: {
				name: region,
				listen: "0.0.0.0:7222",
				gateways: regions.map((region) => ({
					name: region,
					urls: [`nats://messenger.process.${region}.${app}.internal:7222`],
				})),
			},
			http: "0.0.0.0:8222",
			jetstream: {
				store_dir: "/data/messenger",
			},
			listen: "0.0.0.0:4222",
			server_name: name,
		};
		await Bun.write("/config", JSON.stringify(config, null, 2));
		output = await $`nats-server --config /config`;
		break;
	}

	case "runner": {
		let config = {
			directory: "/data/runner",
			remotes: [
				{
					name: "default",
					url: `http://server.process.${region}.${app}.internal:8476`,
				},
			],
			runner: {
				remotes: ["default"],
			},
			tracing: {
				format: "json",
			},
		};
		await Bun.write("/config", JSON.stringify(config, null, 2));
		output = await $`tangram --config /config serve`;
		break;
	}

	case "server": {
		const config = {
			...baseConfig,
			authentication: {
				providers: {
					github: {
						auth_url: process.env.GITHUB_AUTH_URL,
						client_id: process.env.GITHUB_CLIENT_ID,
						client_secret: process.env.GITHUB_CLIENT_SECRET,
						redirect_url: process.env.GITHUB_REDIRECT_URL,
						token_url: process.env.GITHUB_TOKEN_URL,
					},
				},
			},
			database: {
				...baseConfig.database,
				connections: 10,
			},
			http: {
				url: "http://0.0.0.0:8476",
			},
		};
		await Bun.write("/config", JSON.stringify(config, null, 2));
		output = await $`tangram --config /config serve`;
		break;
	}

	case "store": {
		if (!fs.existsSync("/store.cluster")) {
			await Bun.write("/store.cluster", `store:deadbeef@[${privateIp}]:4500`);
		}
		output = await $`fdbserver -C /store.cluster -d /data/store -p auto:4500`;
		break;
	}

	default: {
		throw new Error("invalid process group");
	}
}

process.exit(output.exitCode);
