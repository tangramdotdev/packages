export type ShebangExecutableMetadata = {
	/** The executable's format. */
	format: "shebang";

	/** The executable's interpreter. */
	interpreter: string;
};

export const shebangExecutableMetadata = async (
	file: tg.File,
): Promise<ShebangExecutableMetadata> => {
	let bytes = await file.read({ length: 128 });
	const index = bytes.indexOf("\n".charCodeAt(0));
	if (index !== -1) {
		bytes = bytes.slice(0, index);
	}
	let text = tg.encoding.utf8.decode(bytes);
	const interpreter = text.match(/^#!\s*(\S+)/)?.[1];
	tg.assert(interpreter);
	return { format: "shebang", interpreter };
};
