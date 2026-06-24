const metadata = {
	name: "ca-certificates",
	version: "2026-05-14",
};

export type Arg = {
	source?: tg.File;
};

export function caCertificates(arg?: Arg) {
	const { version } = metadata;
	const checksum =
		"sha256:86a1f3366afac7c6f8ae9f3c779ac221129328c43f0ab2b8817eb2f362a5025c";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
}

export default caCertificates;
