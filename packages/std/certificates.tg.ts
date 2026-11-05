const metadata = {
	name: "ca-certificates",
	version: "2026-11-05",
};

export type Arg = {
	source?: tg.File | null;
};

export function caCertificates(arg?: Arg) {
	const { version } = metadata;
	const checksum =
		"sha256:427c064216761a1e72a8b30f0d954d08cb6e4435a82091fb865afd20c8497285";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
}

export default caCertificates;

export async function test() {
	return caCertificates();
}
