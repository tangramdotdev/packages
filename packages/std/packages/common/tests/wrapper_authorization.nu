# Run with `nu -I /path/to/tangram/packages/cli wrapper_authorization.nu`.
# Set TANGRAM_TEST_VFS=1 (and TANGRAM_TEST_FSKIT=1 on macOS) to use an installed VFS.
use test.nu *
use tests/lib/vfs.nu

const workspace = path self '../../..'

def main [
	--control: path # Optional test executable built with wrapper recovery disabled.
] {
	let build = cargo test --manifest-path ($workspace | path join Cargo.toml) --package common --locked --no-run --message-format=json | complete
	success $build 'the proxy tests should build'
	let executable = $build.stdout | lines | each { from json }
		| where { $in.reason == 'compiler-artifact' and $in.target.name == 'common' and $in.profile.test }
		| get executable | compact | first
	let temporary = if (($env.TANGRAM_TEST_FSKIT? | default '') | str length) > 0 {
		# FSKit's sandbox permits checkout paths beneath ~/.tangram.
		let root = $env.HOME | path join '.tangram/test-tmp'
		mkdir $root
		mktemp -d --tmpdir-path $root
	} else {
		mktemp -d
	}
	$env.TMPDIR = $temporary
	let server = server spawn --config {
		authentication: { users: { providers: { insecure: true } } }
	}
	let alice = tg login --verbose --name alice | from json
	let bob = tg login --verbose --name bob | from json
	let dependency = tg --token $alice.token put 'tg.file("private dependency")' | str trim
	let source = 'tg.file({"contents":"wrapper","dependencies":{"DEPENDENCY":{"node":DEPENDENCY}}})'
		| str replace --all DEPENDENCY $dependency
	let wrapper = tg --token $alice.token put $source | str trim
	# FSKit's provider can access the wrapper, but the dependency has no direct public grant.
	tg --token $alice.token grant public object_subtree $wrapper | ignore
	for name in [one two three] {
		let source = 'tg.directory({"NAME":DEPENDENCY})'
			| str replace NAME $name
			| str replace DEPENDENCY $dependency
		tg --token $alice.token put $source | ignore
	}
	tg --token $alice.token index
	let wrapper_path = tg --token $alice.token checkout $wrapper | str trim
	if (($env.TANGRAM_TEST_VFS? | default '') | str length) > 0 {
		assert equal ($wrapper_path | path expand) (vfs root $server.directory $wrapper)
	}
	let config = $server.config | merge deep {
		authorization: {
			final: {
				ancestor: { max_depth: 1, max_edges: 1, max_nodes: 2 }
				descendant: { max_depth: 0, max_edges: 0, max_nodes: 0 }
				subtree: { max_objects: 0 }
			}
			index: { delay: null }
			initial: false
		}
	}
	$config | to json | save --force $server.config_path
	let server = server restart ($server | upsert config $config)
	try {
		if (($env.TANGRAM_TEST_VFS? | default '') | str length) > 0 {
			vfs assert_mounted $server.directory
		}
		let output = tg --token $bob.token get $dependency | complete
		failure $output 'the bare dependency ID must exhaust authorization'
		assert ($output.stderr | str contains 'the authorization search exhausted')

		# Each fresh process runs the shared resolver and then loads the serialized reference from the server.
		let environment = {
			TANGRAM_TOKEN: $bob.token
			TANGRAM_INJECTION_IDENTITY_PATH: $wrapper_path
			COMMON_TEST_DEPENDENCY_ID: $dependency
		}
		let test = 'references::wrapper_tests::unrender_loads_checked_out_dependency_from_server'
		if $control != null {
			let output = with-env $environment { ^$control --exact $test --ignored --nocapture | complete }
			failure $output 'proxy without wrapper recovery must exhaust authorization'
			assert ($output.stderr | str contains 'the authorization search exhausted')
		}
		let output = with-env $environment { ^$executable --exact $test --ignored --nocapture | complete }
		success $output 'proxy must recover the token and load the dependency'
	} catch { |error|
		server stop $server
		rm -rf $temporary
		error make $error
	}
	server stop $server
	rm -rf $temporary
}
