const metadata = {
	name: "ca-certificates",
	version: "2026-07-16",
};

export type Arg = {
	source?: tg.File | null;
};

export function caCertificates(arg?: Arg) {
	const { version } = metadata;
	const checksum =
		"sha256:3ff344e30b9b1ed2971044eabb438a08f2e2245ddb5f8ab1a3ad8b63ab4eaf91";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
}

export default caCertificates;
