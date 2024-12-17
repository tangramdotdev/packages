#!/bin/sh

# REQUIRES: bun,tangram,jq,fly

set -eux

# Define tangram binary
TANGRAM=${TANGRAM:=tangram}
export TANGRAM

# set up directories
WORKDIR="$(mktemp -d)"
export WORKDIR
REMOTE=$WORKDIR/remote
export REMOTE
mkdir -p "$REMOTE"/.tangram
LOCAL=$WORKDIR/local
export LOCAL
mkdir "$LOCAL"

# Create wrapper scripts to append the correct args.
cat <<EOF > "$REMOTE/tg_remote"
#!/bin/sh
exec $TANGRAM --config "$REMOTE/config.json" --path "$REMOTE/.tangram" "\$@"
EOF
chmod +x "$REMOTE/tg_remote"

cat <<EOF > "$LOCAL/tg_local"
#!/bin/sh
exec $TANGRAM --config "$LOCAL/config.json" --path "$HOME/.tangram" "\$@"
EOF
chmod +x "$LOCAL/tg_local"

cleanup() {
    # Kill process groups to ensure all child processes are terminated
    if [ ! -z ${LOCAL_PID+x} ]; then
        pkill -P $LOCAL_PID 2>/dev/null || true
        kill -TERM -$LOCAL_PID 2>/dev/null || true
    fi
    if [ ! -z ${REMOTE_PID+x} ]; then
        pkill -P $REMOTE_PID 2>/dev/null || true
        kill -TERM -$REMOTE_PID 2>/dev/null || true
    fi
    # Remove temporary directory
    rm -rf "$WORKDIR"
}
trap cleanup EXIT INT TERM

FLY_APP="tangram-api"
DB_PATH="$REMOTE/.tangram/database"
CLOUD_DB_PATH="/data/.tangram/database"

get_cloud_machine_id() {
	fly machines list -a "$FLY_APP" --json | jq -r '.[0].id'
}

# Function to wait for machine state
wait_for_state() {
    expected_state=$1
    max_attempts=30
    attempt=1

    while [ $attempt -le $max_attempts ]; do
        current_state=$(fly machines list -a "$FLY_APP" --json | jq -r '.[0].state')
        
        if [ "$current_state" = "$expected_state" ]; then
            return 0
        fi
        
        echo "Waiting for machine to reach $expected_state state (attempt $attempt/$max_attempts)..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "Timeout waiting for machine to reach $expected_state state"
    return 1
}

pull_from_cloud() {
	echo "pulling from cloud..."
	fly sftp get -a "$FLY_APP" "$CLOUD_DB_PATH" "$DB_PATH"
	echo "Successfully pulled to ${DB_PATH}"
}

push_to_cloud() {
    echo "pushing to cloud..."
    # Use tangram get to ensure all blobs are stored
    find "$REMOTE"/.tangram/blobs -type f -exec basename {} \; | while read -r blob_id; do
        tg_remote get "$blob_id" > /dev/null 2>&1
    done

    pkill -P $REMOTE_PID 2>/dev/null || true
    kill -TERM -$REMOTE_PID 2>/dev/null || true

    sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);"

		CLOUD_MACHINE_ID=$(get_cloud_machine_id)

    # Stop the fly machine
    fly machines stop "$CLOUD_MACHINE_ID" -a "$FLY_APP"
    wait_for_state "stopped"
    # Attach the volume to a new fly machine that sleeps infinitely
    # Swap the database
    # Stop the maintenence machine
    # Restart the real machine
    fly machines start "$CLOUD_MACHINE_ID" -a "$FLY_APP"
    wait_for_state "started"

 #    # Create a backup of the database in the cloud
 #    fly ssh console -a "$FLY_APP" -s -C "cp ${CLOUD_DB_PATH} ${CLOUD_DB_PATH}.backup-`date +%Y%m%d_%H%M%S`"

 #    # Stop the server
 #    fly ssh console -a "$FLY_APP" -s -C "/tangram-control stop"

 # # Push both the main database and WAL files
 #    echo "put ${DB_PATH} ${CLOUD_DB_PATH}.tmp" | fly sftp shell -a "$FLY_APP"
    
 #    # Atomically move files into place
 #    fly ssh console -a "$FLY_APP" -s -C "mv ${CLOUD_DB_PATH}.tmp ${CLOUD_DB_PATH}"
    
 #    # Start the server again
 #    fly ssh console -a "$FLY_APP" -s -C "/tangram-control start"

    echo "Successfully pushed to ${CLOUD_DB_PATH}"
}

# set up remote config
cat <<EOF > "$REMOTE"/config.json
{
	"advanced": {
		"error_trace_options": {
			"internal": true
		}
	},
	"build": null,
	"remotes": null,
	"tracing": {
		"filter": "tangram_server=info",
		"format": "pretty"
	},
	"url": "http://localhost:5429",
	"vfs": null
}
EOF

pull_from_cloud

# start remote server
tg_remote serve &
REMOTE_PID=$!
ps -o pid,pgid,command -p $REMOTE_PID || true

# set up local config
cat <<EOF > "$LOCAL"/config.json
{
	"advanced": {
		"error_trace_options": {
			"internal": true
		}
	},
	"remotes": {
	  "default": {
	    "url": "http://localhost:5429"
	  }
	},
	"tracing": {
		"filter": "tangram_server=info",
		"format": "pretty"
	},
	"vfs": null
}
EOF

tg_local serve &
LOCAL_PID=$!
ps -o pid,pgid,command -p $LOCAL_PID || true

# FIXME - uncomment remaining packages
# PACKAGES="std jq m4 bison rust pcre2 ripgrep pkgconf pkg-config ncurses readline zlib sqlite"
PACKAGES="std jq"

export TG_EXE="$LOCAL/tg_local"
bun run auto -p --seq $PACKAGES

push_to_cloud
