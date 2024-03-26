import * as std from "tg:std" with { path: "../std" };

/** Source code for the version of Ruby to bootstrap. Use 2.5.0, the earliest supported. */
export let source = tg.target(async () => {
	let download = await std.download({
		url: "https://cache.ruby-lang.org/pub/ruby/2.5/ruby-2.5.0.tar.gz",
		checksum:
			"sha256:46e6f3630f1888eb653b15fa811d77b5b1df6fd7a3af436b343cfe4f4503f2ab",
		unpackFormat: ".tar.gz",
	});
	tg.Directory.assert(download);
	return tg.Directory.expect(await std.directory.unwrap(download));
});

/** Returns an older version of Ruby that is only used to bootstrap it. */
export let ruby = tg.target(async (host: std.triple) => {
	let build = await std.build(
		tg`
			${source()}/configure --prefix $OUTPUT
			make install
		`,
		{ env: std.sdk() },
	);

	tg.Directory.assert(build);
	let rubylib = tg.Template.join(
		":",
		...(await Promise.all([
			tg`${build}/lib/ruby/site_ruby/2.5.0`,
			tg`${build}/lib/ruby/site_ruby/2.5.0/${host.arch}-${host.os}`,
			tg`${build}/lib/ruby/site_ruby`,
			tg`${build}/lib/ruby/vendor_ruby/2.5.0`,
			tg`${build}/lib/ruby/vendor_ruby/2.5.0/${host.arch}-${host.os}`,
			tg`${build}/lib/ruby/vendor_ruby`,
			tg`${build}/lib/ruby/2.5.0`,
			tg`${build}/lib/ruby/2.5.0/${host.arch}-${host.os}`,
		])),
	);
	return tg.directory({
		["bin/ruby"]: std.wrap({
			executable: tg.symlink(tg`${build}/bin/ruby`),
			env: {
				RUBYLIB: tg.Mutation.templateAppend(rubylib, ":"),
				GEM_PATH: tg.Mutation.templateAppend(
					tg`${build}/lib/ruby/gems/2.5.0`,
					":",
				),
			},
		}),
	});
});
