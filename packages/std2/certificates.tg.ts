const metadata = {
	name: "ca-certificates",
	version: "2024-11-26",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = tg.target((arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:bb1782d281fe60d4a2dcf41bc229abe3e46c280212597d4abcc25bddf667739b";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
});

export default caCertificates;
