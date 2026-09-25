const metadata = {
	name: "ca-certificates",
	version: "2026-09-25",
};

export type Arg = {
	source?: tg.File | null;
};

export function caCertificates(arg?: Arg) {
	const { version } = metadata;
	const checksum =
		"sha256:a41b5d356aea97a529fe27e0f7316d2f9d946d75927476cf9cf1b90637d00505";
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

/** The tests in this module, grouped by tier. */
export const tests = {
	bootstrap: [test],
};
