import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import attr from "./attr.tg.ts";
import libiconv from "./libiconv.tg.ts";
import coreutils from "./coreutils.tg.ts";
import diffutils from "./diffutils.tg.ts";
import rlimitFix from "./patch-rlimit-fix.patch" with { type: "file" };

export const metadata = {
	name: "patch",
	version: "2.7.6",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ac610bda97abe0d9f6b7c963255a11dcb196c25e337c61f94e4778d632f1d8fd";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
	// Apply rlimit fix.
	// See https://savannah.gnu.org/bugs/index.php?62958
	source = await bootstrap.patch(source, rlimitFix);
	return source;
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.command(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const dependencies: tg.Unresolved<std.Args<std.env.Arg>> = [
		prerequisites(build),
	];
	if (std.triple.os(host) === "linux") {
		dependencies.push(
			attr({
				build,
				env: env_,
				host,
				sdk,
				staticBuild: false,
				usePrerequisites: true,
			}),
		);
	}
	const env = std.env.arg(env_, ...dependencies);

	const output = buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	return output;
});

export default build;

export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);
	const patchArtifact = await build({ host, sdk: false, env: sdk });

	// Ensure the installed command preserves xattrs.
	let expected;
	let script;
	if (os === "linux") {
		script = tg`
        env
        log() {
            echo "$1" | tee -a "$OUTPUT"
        }
        # Create original file with content
        echo "original content" > test-file.txt
        log "Setting xattrs..."
        setfattr -n user.tangram -v "test value" test-file.txt
        log "Getting xattrs from original file:"
        log "$(getfattr -n user.tangram test-file.txt)"

        # Create modified version for patch
        echo "modified content" > test-file-new.txt
        diff -u test-file.txt test-file-new.txt > changes.patch

        # Create test directory and copy original file
        mkdir patch-test
        cp test-file.txt patch-test/
        
        # Apply patch
        cd patch-test
        log "Applying patch..."
        patch < ../changes.patch
        
        log "Getting xattrs from patched file:"
        log "$(getfattr -n user.tangram test-file.txt)"
    `;
		expected = `Setting xattrs...\nGetting xattrs from original file:\n# file: test-file.txt\nuser.tangram="test value"\nApplying patch...\nGetting xattrs from patched file:\n# file: test-file.txt\nuser.tangram="test value"`;
	} else if (os === "darwin") {
		script = tg`
        log() {
            echo "$1" | tee -a "$OUTPUT"
        }
        # Create original file with content
        echo "original content" > test-file.txt
        log "Setting xattrs..."
        xattr -w user.tangram "test value" test-file.txt
        log "Getting xattrs from original file:"
        log "$(xattr -p user.tangram test-file.txt)"

        # Create modified version for patch
        echo "modified content" > test-file-new.txt
        diff -u test-file.txt test-file-new.txt > changes.patch

        # Create test directory and copy original file
        mkdir patch-test
        cp test-file.txt patch-test/
        
        # Apply patch
        cd patch-test
        log "Applying patch..."
        patch < ../changes.patch
        
        log "Getting xattrs from patched file:"
        log "$(xattr -p user.tangram test-file.txt)"
    `;
		expected = `Setting xattrs...\nGetting xattrs from original file:\ntest value\nApplying patch...\nGetting xattrs from patched file:\ntest value`;
	} else {
		return tg.unreachable();
	}
	// Run the script.
	const platformSupportLib =
		os === "darwin"
			? libiconv({ host, sdk: false, env: sdk })
			: attr({ host, sdk: false, env: sdk });
	const output = tg.File.expect(
		await (
			await tg.target(script, {
				env: std.env.arg(
					coreutils({ host, sdk: false, env: sdk }),
					diffutils({ host, sdk: false, env: sdk }),
					platformSupportLib,
					patchArtifact,
				),
			})
		).output(),
	);

	const contents = (await output.text()).trim();
	tg.assert(contents === expected);

	return patchArtifact;
});
