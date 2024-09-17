const metadata = {
	name: "ca-certificates",
	version: "2024-07-02",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = tg.target((arg?: Arg) => {
	const { version } = metadata;
	const checksum = "sha256:1bf458412568e134a4514f5e170a328d11091e071c7110955c9884ed87972ac9";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
});

export default caCertificates;
