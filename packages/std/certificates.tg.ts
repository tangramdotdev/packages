const metadata = {
	name: "ca-certificates",
	version: "2024-12-31",
};

export type Arg = {
	source?: tg.File;
};

export const caCertificates = tg.command((arg?: Arg) => {
	const { version } = metadata;
	const checksum =
		"sha256:a3f328c21e39ddd1f2be1cea43ac0dec819eaa20a90425d7da901a11531b3aa5";
	const url = "https://curl.se/ca";
	const source =
		arg?.source ?? tg.download(`${url}/cacert-${version}.pem`, checksum);
	return tg.directory({
		"ca-bundle.crt": tg.symlink("./cacert.pem"),
		"cacert.pem": source,
	});
});

export default caCertificates;
