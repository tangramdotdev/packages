const metadata = {
	name: "ca-certificates",
	version: "2026-08-13",
};

export type Arg = {
	source?: tg.File | null;
};

export function caCertificates(arg?: Arg) {
	const { version } = metadata;
	const checksum =
		"sha256:f66dff1bdf8f96060b8177976f8b7d9254bc89bc4db933d769f7384d28480bc9";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
}

export default caCertificates;
