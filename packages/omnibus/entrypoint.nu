#!/usr/bin/env nu

def main [] {
	let app = $env.FLY_APP_NAME
	let regions = ["iad"]
	let region = $env.FLY_REGION
	let process_group = $env.FLY_PROCESS_GROUP
	let private_ip = $env.FLY_PRIVATE_IP
	let name = $env.FLY_MACHINE_NAME

	let base_config = {
		cleaner: false,
		database: {
			kind: "postgres",
			url: $"postgres://postgres@database.process.($app).internal"
		},
		http: false,
		index: {
			kind: "postgres",
			url: $"postgres://postgres@index.process.($app).internal"
		},
		indexer: false,
		messenger: {
			kind: "nats",
			url: $"nats://messenger.process.($app).internal"
		},
		remotes: [],
		runner: false,
		store: {
			kind: "fdb",
			path: "/store.cluster"
		},
		tracing: {
			filter: "tangram_server=trace",
			format: "json"
		},
		vfs: false,
		watchdog: false
	}

	let store_cluster = $env.STORE_CLUSTER?
	if $store_cluster != null {
		$store_cluster | save -f /store.cluster
	}

	match $process_group {
		"cleaner" => {
			let config = ($base_config | merge {
				cleaner: {
					ttl: 3600
				},
				database: ($base_config.database | merge {
					connections: 1
				})
			})
			$config | to json | save -f /config
			tangram --config /config serve
		},

		"database" => {
			let script = '
				mkdir -p /data/database
				chown postgres:postgres /data/database
				if [ ! -f /data/database/postgresql.conf ]; then
					sudo -u postgres initdb -D /data/database
					echo "listen_addresses = '\''*'\''" > /data/database/postgresql.conf
					echo "max_connections = 100" >> /data/database/postgresql.conf
					echo "host all all 0.0.0.0/0 trust" > /data/database/pg_hba.conf
					echo "host all all ::/0 trust" >> /data/database/pg_hba.conf
				fi
				sudo -u postgres postgres -D /data/database
			'
			$script | save -f /script
			bash /script
		},

		"index" => {
			let script = '
				mkdir -p /data/index
				chown postgres:postgres /data/index
				if [ ! -f /data/index/postgresql.conf ]; then
					sudo -u postgres initdb -D /data/index
					echo "listen_addresses = '\''*'\''" > /data/index/postgresql.conf
					echo "max_connections = 100" >> /data/index/postgresql.conf
					echo "host all all 0.0.0.0/0 trust" > /data/index/pg_hba.conf
					echo "host all all ::/0 trust" >> /data/index/pg_hba.conf
				fi
				sudo -u postgres postgres -D /data/index
			'
			$script | save -f /script
			bash /script
		},

		"indexer" => {
			let config = ($base_config | merge {
				database: ($base_config.database | merge {
					connections: 1
				}),
				indexer: true
			})
			$config | to json | save -f /config
			tangram --config /config serve
		},

		"messenger" => {
			let config = {
				authorization: {
					default_permissions: {
						publish: ["$SYS.>"],
						subscribe: ["$SYS.>"]
					}
				},
				cluster: {
					listen: "0.0.0.0:6222",
					name: $region,
					routes: [$"nats://messenger.process.($region).($app).internal:6222"]
				},
				gateway: {
					name: $region,
					listen: "0.0.0.0:7222",
					gateways: ($regions | each { |region|
						{
							name: $region,
							urls: [$"nats://messenger.process.($region).($app).internal:7222"]
						}
					})
				},
				http: "0.0.0.0:8222",
				jetstream: {
					store_dir: "/data/messenger"
				},
				listen: "0.0.0.0:4222",
				server_name: $name
			}
			$config | to json | save -f /config
			nats-server --config /config
		},

		"runner" => {
			let config = {
				directory: "/data/runner",
				remotes: [
					{
						name: "default",
						url: $"http://server.process.($region).($app).internal:8476"
					}
				],
				runner: {
					remotes: ["default"]
				},
				tracing: {
					format: "json"
				}
			}
			$config | to json | save -f /config
			tangram --config /config serve
		},

		"server" => {
			let config = ($base_config | merge {
				authentication: {
					providers: {
						github: {
							auth_url: $env.GITHUB_AUTH_URL?,
							client_id: $env.GITHUB_CLIENT_ID?,
							client_secret: $env.GITHUB_CLIENT_SECRET?,
							redirect_url: $env.GITHUB_REDIRECT_URL?,
							token_url: $env.GITHUB_TOKEN_URL?,
						}
					}
				},
				database: ($base_config.database | merge {
					connections: 10
				}),
				http: {
					url: "http://0.0.0.0:8476"
				},
				watchdog: {
					batch_size: 100,
					interval: 1,
					ttl: 60
				}
			})
			$config | to json | save -f /config
			tangram --config /config serve
		},

		"store" => {
			if not ("/store.cluster" | path exists) {
				$"store:deadbeef@[($private_ip)]:4500" | save -f /store.cluster
			}
			fdbserver -C /store.cluster -d /data/store -p auto:4500
		},

		_ => {
			error make { msg: "invalid process group" }
		}
	}
}
