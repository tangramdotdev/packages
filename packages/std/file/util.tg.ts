/** Check if a byte array starts with the provided prefix of bytes. */
export const startsWithBytes = (
	bytes: Uint8Array,
	prefix: Iterable<number>,
): boolean => {
	const prefixBytes = Uint8Array.from(prefix);
	if (bytes.length < prefixBytes.length) {
		return false;
	}
	for (let i = 0; i < prefixBytes.length; i++) {
		if (bytes[i] !== prefixBytes[i]) {
			return false;
		}
	}
	return true;
};

/** Read a null-terminated C-string into a JS string. */
export const readNullTerminatedString = (
	bytes: Uint8Array,
	offset: number,
): string => {
	let end = offset;
	while (end < bytes.length && bytes[end] !== 0) {
		end++;
	}
	const slice = bytes.slice(offset, end);
	return tg.encoding.utf8.decode(slice);
};

/** Convert a BigInt value to a number, or throw an error if cannot be converted losslessly. */
export const bigIntToNumber = (value: bigint): number => {
	if (
		value >= BigInt(Number.MIN_SAFE_INTEGER) &&
		value <= BigInt(Number.MAX_SAFE_INTEGER)
	) {
		return Number(value);
	} else {
		throw new Error(`Value ${value} cannot be converted to a number.`);
	}
};
