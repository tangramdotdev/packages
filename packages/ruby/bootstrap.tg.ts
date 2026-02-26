import * as std from "std" with { local: "../std" };

/** Source code for the version of Ruby to bootstrap. */
export const source = async () => {
	return await std.download
		.extractArchive({
			url: "https://cache.ruby-lang.org/pub/ruby/3.1/ruby-3.1.6.tar.gz",
			checksum:
				"sha256:0d0dafb859e76763432571a3109d1537d976266be3083445651dc68deed25c22",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

/** Returns an older version of Ruby that is only used to bootstrap it. */
export const ruby = async (host: string) => {
	const build = await std.autotools.build({
		env: {
			CFLAGS: tg.Mutation.suffix("-std=gnu17", " "),
		},
		host,
		source: source(),
		phases: {
			configure: {
				args: [
					"--disable-install-doc",
					// Skip fiddle ext: its bundled libffi-3.2.1 libtool is incompatible with dash.
					"--with-out-ext=fiddle",
				],
			},
		},
	});

	const { arch: hostArch, os: hostOs } = std.triple.components(host);
	const rubylib = tg.Template.join(
		":",
		...(await Promise.all([
			tg`${build}/lib/ruby/site_ruby/3.1.0`,
			tg`${build}/lib/ruby/site_ruby/3.1.0/${hostArch}-${hostOs}`,
			tg`${build}/lib/ruby/site_ruby`,
			tg`${build}/lib/ruby/vendor_ruby/3.1.0`,
			tg`${build}/lib/ruby/vendor_ruby/3.1.0/${hostArch}-${hostOs}`,
			tg`${build}/lib/ruby/vendor_ruby`,
			tg`${build}/lib/ruby/3.1.0`,
			tg`${build}/lib/ruby/3.1.0/${hostArch}-${hostOs}`,
		])),
	);
	const unwrapped = build.get("bin/ruby").then(tg.File.expect);
	return tg.directory({
		["bin/ruby"]: std.wrap({
			executable: unwrapped,
			env: {
				RUBYLIB: tg.Mutation.suffix(rubylib, ":"),
				GEM_PATH: tg.Mutation.suffix(tg`${build}/lib/ruby/gems/3.1.0`, ":"),
			},
		}),
	});
};
