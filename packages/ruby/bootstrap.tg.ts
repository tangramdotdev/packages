import * as std from "std" with { path: "../std" };

/** Source code for the version of Ruby to bootstrap. Use 2.5.0, the earliest supported. */
export const source = tg.command(async () => {
	return await std.download
		.extractArchive({
			url: "https://cache.ruby-lang.org/pub/ruby/2.5/ruby-2.5.0.tar.gz",
			checksum:
				"sha256:46e6f3630f1888eb653b15fa811d77b5b1df6fd7a3af436b343cfe4f4503f2ab",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

/** Returns an older version of Ruby that is only used to bootstrap it. */
export const ruby = tg.command(async (host: string) => {
	const build = await std.autotools.build({
		env: {
			CFLAGS: tg.Mutation.suffix("-Wno-implicit-function-declaration", " "),
		},
		host,
		source: source(),
	});

	const { arch: hostArch, os: hostOs } = std.triple.components(host);
	const rubylib = tg.Template.join(
		":",
		...(await Promise.all([
			tg`${build}/lib/ruby/site_ruby/2.5.0`,
			tg`${build}/lib/ruby/site_ruby/2.5.0/${hostArch}-${hostOs}`,
			tg`${build}/lib/ruby/site_ruby`,
			tg`${build}/lib/ruby/vendor_ruby/2.5.0`,
			tg`${build}/lib/ruby/vendor_ruby/2.5.0/${hostArch}-${hostOs}`,
			tg`${build}/lib/ruby/vendor_ruby`,
			tg`${build}/lib/ruby/2.5.0`,
			tg`${build}/lib/ruby/2.5.0/${hostArch}-${hostOs}`,
		])),
	);
	return tg.directory({
		["bin/ruby"]: std.wrap({
			executable: tg.symlink(tg`${build}/bin/ruby`),
			env: {
				RUBYLIB: tg.Mutation.suffix(rubylib, ":"),
				GEM_PATH: tg.Mutation.suffix(tg`${build}/lib/ruby/gems/2.5.0`, ":"),
			},
		}),
	});
});
