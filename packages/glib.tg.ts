import * as libffi from "libffi" with { source: "./libffi.tg.ts" };
import * as libiconv from "libiconv" with { source: "./libiconv.tg.ts" };
import * as meson from "meson" with { source: "./meson.tg.ts" };
import * as pcre2 from "pcre2" with { source: "./pcre2.tg.ts" };
import * as python from "python" with { source: "./python" };
import * as std from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://docs.gtk.org/glib/",
	license: "LGPL-2.1-or-later",
	name: "glib",
	repository: "https://gitlab.gnome.org/GNOME/glib",
	version: "2.90.2",
	tag: "glib/2.90.2",
	provides: {
		libraries: [
			{ name: "gio-2.0", pkgConfigName: "gio-2.0", staticlib: false },
			{ name: "glib-2.0", pkgConfigName: "glib-2.0", staticlib: false },
			{ name: "gmodule-2.0", pkgConfigName: "gmodule-2.0", staticlib: false },
			{ name: "gobject-2.0", pkgConfigName: "gobject-2.0", staticlib: false },
			{ name: "gthread-2.0", pkgConfigName: "gthread-2.0", staticlib: false },
		],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:edf473b4f5ee70a31d2410622ee605dc4a2c8c46dbc0ec53c9abbaf3960232fd";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	return std
		.download({
			url: `https://download.gnome.org/sources/${name}/${majorMinor}/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		libffi: libffi.build,
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: { hostOs: "darwin" },
		},
		pcre2: pcre2.build,
		python: { build: python.self, kind: "buildtime" },
		zlib: zlib.build,
	});
}

export type Arg = meson.BuildArg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// The build runs Python scripts that it finds as `python3` on the `PATH`. Leave out the documentation, the tests, the translations, introspection, and the integrations with libmount, SELinux, sysprof, libelf, DTrace, and SystemTap.
	const resolved = await meson.arg(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"-Ddocumentation=false",
						"-Ddtrace=disabled",
						"-Dintrospection=disabled",
						"-Dlibelf=disabled",
						"-Dlibmount=disabled",
						"-Dman-pages=disabled",
						"-Dnls=disabled",
						"-Dselinux=disabled",
						"-Dsysprof=disabled",
						"-Dsystemtap=disabled",
						"-Dtests=false",
					],
				},
				fixup: await fixup(),
			},
		},
		...args,
	);

	// The linker needs rpath-link to find the libraries that libglib and libgobject link when it links the programs.
	const artifacts = await std.deps.artifacts(deps, {
		build: resolved.build,
		host: resolved.host,
	});
	const libDirs = Object.values(artifacts)
		.filter((artifact): artifact is tg.Directory => artifact !== undefined)
		.map((artifact) => tg`${artifact}/lib`);
	const env = std.env.arg(resolved.env ?? null, {
		LDFLAGS: tg.Mutation.suffix(
			tg`-Wl,-rpath-link,${tg.Template.join(":", ...libDirs)}`,
			" ",
		),
	});
	return await meson.build({ ...resolved, env });
}

export default build;

/** Normalize the pkg-config files, and point `libdir` at the prefix in the files that do not define `exec_prefix`, which the normalization refers to. */
async function fixup() {
	const pkgConfigFixup = await std.pkgconfig.shellNormalizeCommand();
	return tg`
		${pkgConfigFixup}
		for pc in ${tg.output}/lib/pkgconfig/*.pc; do
			if ! grep -q '^exec_prefix=' "$pc"; then
				sed -i 's|^libdir=$'"{exec_prefix}"'/lib$|libdir=$'"{prefix}"'/lib|' "$pc"
			fi
		done
	`;
}

export async function test() {
	const os = std.triple.os(std.triple.host());
	const runtimeDeps: Array<tg.Unresolved<tg.Directory>> = [
		libffi.build(),
		pcre2.build(),
		zlib.build(),
	];
	if (os === "darwin") {
		runtimeDeps.push(libiconv.build());
	}
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: metadata.provides.libraries.map((library) => ({
			...library,
			runtimeDeps,
		})),
	};
	return await std.assert.pkg(build, spec);
}
