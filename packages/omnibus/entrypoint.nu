#!/usr/bin/env nu

def main [] {
	let app = $env.FLY_APP_NAME
	let name = $env.NAME
	let private_ip = $env.FLY_PRIVATE_IP
	let region = $env.FLY_REGION
	let regions = $env.REGIONS | split row ','
	let service = $env.SERVICE

	let base_config = {
		cleaner: false,
		database: {
			kind: 'postgres',
			url: $'postgres://postgres@database.process.($app).internal'
		},
		http: false,
		index: {
			kind: 'postgres',
			url: $'postgres://postgres@index.process.($app).internal'
		},
		indexer: false,
		messenger: {
			kind: 'nats',
			url: $'nats://messenger.process.($app).internal'
		},
		remotes: [],
		runner: false,
		store: {
			kind: 'scylla',
			addr: $'store.process.($app).internal',
			keyspace: 'store'
		},
		vfs: false,
		watchdog: false
	}

	match $service {
		cleaner => {
			let config = $base_config | merge {
				cleaner: {
					ttl: 3600
				},
				database: ($base_config.database | merge {
					connections: 1
				})
			}
			mkdir /config/cleaner
			$config | to json | save -f /config/cleaner/config.json
			exec tangram --config /config/cleaner/config.json serve
		},

		database => {
			exec bash -c r#'
				mkdir -p /data/database
				chown postgres:postgres /data/database
				if [ ! -f /data/database/postgresql.conf ]; then
					sudo --preserve-env=PATH -u postgres bash -c "initdb -D /data/database"
					echo "listen_addresses = '*'" > /data/database/postgresql.conf
					echo "max_connections = 100" >> /data/database/postgresql.conf
					echo "host all all 0.0.0.0/0 trust" > /data/database/pg_hba.conf
					echo "host all all ::/0 trust" >> /data/database/pg_hba.conf
				fi
				exec sudo --preserve-env=PATH -u postgres bash -c "postgres -D /data/database"
			'#
		},

		index => {
			exec bash -c r#'
				mkdir -p /data/index
				chown postgres:postgres /data/index
				if [ ! -f /data/index/postgresql.conf ]; then
					sudo --preserve-env=PATH -u postgres bash -c "initdb -D /data/index"
					echo "listen_addresses = '*'" > /data/index/postgresql.conf
					echo "max_connections = 100" >> /data/index/postgresql.conf
					echo "host all all 0.0.0.0/0 trust" > /data/index/pg_hba.conf
					echo "host all all ::/0 trust" >> /data/index/pg_hba.conf
				fi
				exec sudo --preserve-env=PATH -u postgres bash -c "postgres -D /data/index"
			'#
		},

		indexer => {
			let config = $base_config | merge {
				database: ($base_config.database | merge {
					connections: 1,
				}),
				indexer: true,
			}
			mkdir /config/indexer
			$config | to json | save -f /config/indexer/config.json
			exec tangram --config /config/indexer/config.json serve
		},

		messenger => {
			let config = {
				accounts: {
					'$SYS': {
						users: [{ user: 'admin', password: 'admin' }],
					}
				},
				cluster: {
					listen: '0.0.0.0:6222',
					name: $region,
					routes: [$'nats://messenger.process.($region).($app).internal:6222'],
				},
				gateway: {
					name: $region,
					listen: '0.0.0.0:7222',
					gateways: ($regions | each { |region|
						{
							name: $region,
							urls: [$'nats://messenger.process.($region).($app).internal:7222'],
						}
					})
				},
				http: '0.0.0.0:8222',
				jetstream: {
					store_dir: '/data/messenger',
				},
				listen: '0.0.0.0:4222',
				server_name: $name,
			}
			mkdir /config/messenger
			$config | to json | save -f /config/messenger/nats.conf
			exec nats-server --config /config/messenger/nats.conf
		},

		runner => {
			let config = {
				directory: '/data/runner',
				remotes: [
					{
						name: 'default',
						url: $'http://server.process.($region).($app).internal:8476'
					}
				],
				runner: {
					remotes: ['default']
				},
				tracing: {
					format: 'json'
				}
			}
			mkdir /config/runner
			$config | to json | save -f /config/runner/config.json
			exec tangram --config /config/runner/config.json serve
		},

		server => {
			let config = $base_config | merge {
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
					url: 'http://0.0.0.0:8476'
				},
				watchdog: {
					batch_size: 100,
					interval: 1,
					ttl: 60
				}
			}
			mkdir /config/server
			$config | to json | save -f /config/server/config.json
			exec tangram --config /config/server/config.json serve
		},

		store => {
			mkdir /config/store
			mkdir /data/store
			touch /config/store/scylla.yaml
			if not ('/config/store/io_properties.yaml' | path exists) {
				(
					iotune
					--duration=10
					--evaluation-directory=/data/store
					--properties-file=/config/store/io_properties.yaml
				)
			}
			let seeds = dig +short aaaa $'store.process.($app).internal' | lines | str join ','
			(
				exec scylla
				$'--broadcast-rpc-address=($private_ip)'
				--commitlog-directory=/data/store/commitlog
				--data-file-directories=/data/store/data
				--enable-ipv6-dns-lookup=1
				--io-properties-file=/config/store/io_properties.yaml
				$'--listen-address=($private_ip)'
				--options-file=/config/store/scylla.yaml
				$'--rpc-address=($private_ip)'
				--seed-provider-parameters $'seeds=($seeds)'
			)
		},

		_ => {
			error make { msg: 'invalid process group' }
		}
	}
}
