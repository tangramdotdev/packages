/** General-purpose assertion library with chainable matchers. */

export type Expectation<T> = {
	/** The actual value being tested. */
	actual: T;
	/** Whether this expectation is negated. */
	isNot: boolean;
	/** Negate the matcher - inverts the assertion. */
	not: Expectation<T>;

	// Equality matchers
	/** Strict equality check (===). */
	toBe(expected: T): void;
	/** Deep equality check for objects and arrays. */
	toEqual(expected: T): void;
	/** Check if value is strictly equal to true. */
	toBeTruthy(): void;
	/** Check if value is strictly equal to false. */
	toBeFalsy(): void;
	/** Check if value is null. */
	toBeNull(): void;
	/** Check if value is undefined. */
	toBeUndefined(): void;
	/** Check if value is defined (not undefined). */
	toBeDefined(): void;

	// Type matchers
	/** Check if value is an instance of a class/constructor. */
	toBeInstanceOf(constructor: new (...args: any[]) => any): void;

	// Numeric matchers
	/** Check if number is greater than expected. */
	toBeGreaterThan(expected: number): void;
	/** Check if number is greater than or equal to expected. */
	toBeGreaterThanOrEqual(expected: number): void;
	/** Check if number is less than expected. */
	toBeLessThan(expected: number): void;
	/** Check if number is less than or equal to expected. */
	toBeLessThanOrEqual(expected: number): void;
	/** Check if number is close to expected within precision. */
	toBeCloseTo(expected: number, precision?: number): void;

	// String matchers
	/** Check if string contains substring. */
	toContain(substring: string): void;
	/** Check if string matches regex pattern. */
	toMatch(pattern: RegExp | string): void;
	/** Check if string starts with prefix. */
	toStartWith(prefix: string): void;
	/** Check if string ends with suffix. */
	toEndWith(suffix: string): void;

	// Array/Collection matchers
	/** Check if array contains item. */
	toContainItem<U>(item: U): void;
	/** Check if array contains all items. */
	toContainAllItems<U>(items: U[]): void;
	/** Check if array has specific length. */
	toHaveLength(length: number): void;
	/** Check if array/object is empty. */
	toBeEmpty(): void;

	// Object matchers
	/** Check if object has property. */
	toHaveProperty(property: string, value?: any): void;
	/** Check if object matches subset of properties. */
	toMatchObject(subset: Partial<T>): void;

	// Function matchers
	/** Check if function throws an error. */
	toThrow(expected?: string | RegExp | Error): void;
	/** Check if async function rejects with error. */
	toReject(expected?: string | RegExp | Error): Promise<void>;
	/** Check if function was called (for mock functions). */
	toHaveBeenCalled(): void;
	/** Check if function was called N times (for mock functions). */
	toHaveBeenCalledTimes(times: number): void;
	/** Check if function was called with specific args (for mock functions). */
	toHaveBeenCalledWith(...args: any[]): void;

	// Tangram-specific matchers
	/** Check if value is a Tangram artifact (File, Directory, or Symlink). */
	toBeArtifact(): void;
	/** Check if value is a Tangram File. */
	toBeFile(): void;
	/** Check if value is a Tangram Directory. */
	toBeDirectory(): void;
	/** Check if value is a Tangram Symlink. */
	toBeSymlink(): void;
	/** Check if Tangram artifact exists at path. */
	toExistAt(path: string): Promise<void>;

	// Snapshot matchers
	/** Check if value matches JSON snapshot with whitespace normalization. */
	toMatchJsonSnapshot(expected: string): void;
};

/** Create an expectation for the given value. */
export const expect = <T>(actual: T): Expectation<T> => {
	return createExpectation(actual, false);
};

const createExpectation = <T>(actual: T, isNot: boolean): Expectation<T> => {
	const expectation: Expectation<T> = {
		actual,
		isNot,
		get not(): Expectation<T> {
			return createExpectation(actual, !isNot);
		},

		// Equality matchers
		toBe(expected: T): void {
			const pass = Object.is(actual, expected);
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be ${formatValue(expected)}`,
				`Expected ${formatValue(actual)} not to be ${formatValue(expected)}`,
			);
		},

		toEqual(expected: T): void {
			const pass = deepEqual(actual, expected);
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to equal ${formatValue(expected)}`,
				`Expected ${formatValue(actual)} not to equal ${formatValue(expected)}`,
			);
		},

		toBeTruthy(): void {
			const pass = !!actual;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be truthy`,
				`Expected ${formatValue(actual)} not to be truthy`,
			);
		},

		toBeFalsy(): void {
			const pass = !actual;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be falsy`,
				`Expected ${formatValue(actual)} not to be falsy`,
			);
		},

		toBeNull(): void {
			const pass = actual === null;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be null`,
				`Expected ${formatValue(actual)} not to be null`,
			);
		},

		toBeUndefined(): void {
			const pass = actual === undefined;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be undefined`,
				`Expected ${formatValue(actual)} not to be undefined`,
			);
		},

		toBeDefined(): void {
			const pass = actual !== undefined;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be defined`,
				`Expected ${formatValue(actual)} not to be defined`,
			);
		},

		// Type matchers
		toBeInstanceOf(constructor: new (...args: any[]) => any): void {
			const pass = actual instanceof constructor;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be instance of ${constructor.name}`,
				`Expected ${formatValue(actual)} not to be instance of ${constructor.name}`,
			);
		},

		// Numeric matchers
		toBeGreaterThan(expected: number): void {
			const pass = typeof actual === "number" && actual > expected;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be greater than ${expected}`,
				`Expected ${formatValue(actual)} not to be greater than ${expected}`,
			);
		},

		toBeGreaterThanOrEqual(expected: number): void {
			const pass = typeof actual === "number" && actual >= expected;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be greater than or equal to ${expected}`,
				`Expected ${formatValue(actual)} not to be greater than or equal to ${expected}`,
			);
		},

		toBeLessThan(expected: number): void {
			const pass = typeof actual === "number" && actual < expected;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be less than ${expected}`,
				`Expected ${formatValue(actual)} not to be less than ${expected}`,
			);
		},

		toBeLessThanOrEqual(expected: number): void {
			const pass = typeof actual === "number" && actual <= expected;
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be less than or equal to ${expected}`,
				`Expected ${formatValue(actual)} not to be less than or equal to ${expected}`,
			);
		},

		toBeCloseTo(expected: number, precision: number = 2): void {
			if (typeof actual !== "number") {
				throw new Error(`Expected ${formatValue(actual)} to be a number`);
			}
			const pass = Math.abs(actual - expected) < Math.pow(10, -precision) / 2;
			assertMatcher(
				pass,
				isNot,
				`Expected ${actual} to be close to ${expected} (precision: ${precision})`,
				`Expected ${actual} not to be close to ${expected} (precision: ${precision})`,
			);
		},

		// String matchers
		toContain(substring: string): void {
			if (typeof actual !== "string") {
				throw new Error(`Expected ${formatValue(actual)} to be a string`);
			}
			const pass = actual.includes(substring);
			assertMatcher(
				pass,
				isNot,
				`Expected "${actual}" to contain "${substring}"`,
				`Expected "${actual}" not to contain "${substring}"`,
			);
		},

		toMatch(pattern: RegExp | string): void {
			if (typeof actual !== "string") {
				throw new Error(`Expected ${formatValue(actual)} to be a string`);
			}
			const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
			const pass = regex.test(actual);
			assertMatcher(
				pass,
				isNot,
				`Expected "${actual}" to match ${regex}`,
				`Expected "${actual}" not to match ${regex}`,
			);
		},

		toStartWith(prefix: string): void {
			if (typeof actual !== "string") {
				throw new Error(`Expected ${formatValue(actual)} to be a string`);
			}
			const pass = actual.startsWith(prefix);
			assertMatcher(
				pass,
				isNot,
				`Expected "${actual}" to start with "${prefix}"`,
				`Expected "${actual}" not to start with "${prefix}"`,
			);
		},

		toEndWith(suffix: string): void {
			if (typeof actual !== "string") {
				throw new Error(`Expected ${formatValue(actual)} to be a string`);
			}
			const pass = actual.endsWith(suffix);
			assertMatcher(
				pass,
				isNot,
				`Expected "${actual}" to end with "${suffix}"`,
				`Expected "${actual}" not to end with "${suffix}"`,
			);
		},

		// Array/Collection matchers
		toContainItem<U>(item: U): void {
			if (!Array.isArray(actual)) {
				throw new Error(`Expected ${formatValue(actual)} to be an array`);
			}
			const pass = actual.some((x) => deepEqual(x, item));
			assertMatcher(
				pass,
				isNot,
				`Expected array to contain ${formatValue(item)}`,
				`Expected array not to contain ${formatValue(item)}`,
			);
		},

		toContainAllItems<U>(items: U[]): void {
			if (!Array.isArray(actual)) {
				throw new Error(`Expected ${formatValue(actual)} to be an array`);
			}
			const pass = items.every((item) =>
				actual.some((x) => deepEqual(x, item)),
			);
			assertMatcher(
				pass,
				isNot,
				`Expected array to contain all items ${formatValue(items)}`,
				`Expected array not to contain all items ${formatValue(items)}`,
			);
		},

		toHaveLength(length: number): void {
			const actualLength = (actual as any)?.length;
			if (actualLength === undefined) {
				throw new Error(
					`Expected ${formatValue(actual)} to have length property`,
				);
			}
			const pass = actualLength === length;
			assertMatcher(
				pass,
				isNot,
				`Expected length to be ${length}, got ${actualLength}`,
				`Expected length not to be ${length}`,
			);
		},

		toBeEmpty(): void {
			let pass = false;
			if (Array.isArray(actual)) {
				pass = actual.length === 0;
			} else if (typeof actual === "string") {
				pass = actual.length === 0;
			} else if (actual && typeof actual === "object") {
				pass = Object.keys(actual).length === 0;
			}
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be empty`,
				`Expected ${formatValue(actual)} not to be empty`,
			);
		},

		// Object matchers
		toHaveProperty(property: string, value?: any): void {
			if (!actual || typeof actual !== "object") {
				throw new Error(`Expected ${formatValue(actual)} to be an object`);
			}
			const hasProperty = property in actual;
			if (!hasProperty) {
				assertMatcher(
					false,
					isNot,
					`Expected object to have property "${property}"`,
					`Expected object not to have property "${property}"`,
				);
				return;
			}
			if (value !== undefined) {
				const pass = deepEqual((actual as any)[property], value);
				assertMatcher(
					pass,
					isNot,
					`Expected property "${property}" to equal ${formatValue(value)}`,
					`Expected property "${property}" not to equal ${formatValue(value)}`,
				);
			} else {
				assertMatcher(
					true,
					isNot,
					`Expected object to have property "${property}"`,
					`Expected object not to have property "${property}"`,
				);
			}
		},

		toMatchObject(subset: Partial<T>): void {
			if (!actual || typeof actual !== "object") {
				throw new Error(`Expected ${formatValue(actual)} to be an object`);
			}
			const pass = matchesSubset(actual, subset);
			assertMatcher(
				pass,
				isNot,
				`Expected object to match subset ${formatValue(subset)}`,
				`Expected object not to match subset ${formatValue(subset)}`,
			);
		},

		// Function matchers
		toThrow(expected?: string | RegExp | Error): void {
			if (typeof actual !== "function") {
				throw new Error(`Expected ${formatValue(actual)} to be a function`);
			}
			let didThrow = false;
			let thrownError: any;
			try {
				(actual as any)();
			} catch (error) {
				didThrow = true;
				thrownError = error;
			}

			if (!didThrow) {
				assertMatcher(
					false,
					isNot,
					"Expected function to throw",
					"Expected function not to throw",
				);
				return;
			}

			if (expected !== undefined) {
				const pass = matchesError(thrownError, expected);
				assertMatcher(
					pass,
					isNot,
					`Expected function to throw matching ${formatValue(expected)}`,
					`Expected function not to throw matching ${formatValue(expected)}`,
				);
			}
		},

		async toReject(expected?: string | RegExp | Error): Promise<void> {
			if (
				!actual ||
				typeof actual !== "object" ||
				!("then" in actual) ||
				typeof (actual as any).then !== "function"
			) {
				throw new Error(`Expected ${formatValue(actual)} to be a Promise`);
			}

			let didReject = false;
			let rejectionError: any;
			try {
				await actual;
			} catch (error) {
				didReject = true;
				rejectionError = error;
			}

			if (!didReject) {
				assertMatcher(
					false,
					isNot,
					"Expected promise to reject",
					"Expected promise not to reject",
				);
				return;
			}

			if (expected !== undefined) {
				const pass = matchesError(rejectionError, expected);
				assertMatcher(
					pass,
					isNot,
					`Expected promise to reject with ${formatValue(expected)}`,
					`Expected promise not to reject with ${formatValue(expected)}`,
				);
			}
		},

		// Mock function matchers (stubs for now)
		toHaveBeenCalled(): void {
			throw new Error("Mock function matchers not yet implemented");
		},

		toHaveBeenCalledTimes(times: number): void {
			throw new Error("Mock function matchers not yet implemented");
		},

		toHaveBeenCalledWith(...args: any[]): void {
			throw new Error("Mock function matchers not yet implemented");
		},

		// Tangram-specific matchers
		toBeArtifact(): void {
			const pass =
				tg.File.is(actual) || tg.Directory.is(actual) || tg.Symlink.is(actual);
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be a Tangram artifact`,
				`Expected ${formatValue(actual)} not to be a Tangram artifact`,
			);
		},

		toBeFile(): void {
			const pass = tg.File.is(actual);
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be a Tangram File`,
				`Expected ${formatValue(actual)} not to be a Tangram File`,
			);
		},

		toBeDirectory(): void {
			const pass = tg.Directory.is(actual);
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be a Tangram Directory`,
				`Expected ${formatValue(actual)} not to be a Tangram Directory`,
			);
		},

		toBeSymlink(): void {
			const pass = tg.Symlink.is(actual);
			assertMatcher(
				pass,
				isNot,
				`Expected ${formatValue(actual)} to be a Tangram Symlink`,
				`Expected ${formatValue(actual)} not to be a Tangram Symlink`,
			);
		},

		async toExistAt(path: string): Promise<void> {
			if (!tg.Directory.is(actual)) {
				throw new Error(
					`Expected ${formatValue(actual)} to be a Tangram Directory`,
				);
			}
			const entry = await actual.tryGet(path);
			const pass = entry !== undefined;
			assertMatcher(
				pass,
				isNot,
				`Expected directory to contain path "${path}"`,
				`Expected directory not to contain path "${path}"`,
			);
		},

		// Snapshot matchers
		toMatchJsonSnapshot(expected: string): void {
			const actualJson = JSON.stringify(actual, null, "\t");
			const expectedNormalized = normalizeSnapshotString(expected);
			const pass = actualJson === expectedNormalized;
			assertMatcher(
				pass,
				isNot,
				`Expected JSON to match snapshot:\nActual:\n${actualJson}\n\nExpected:\n${expectedNormalized}`,
				`Expected JSON not to match snapshot`,
			);
		},
	};

	return expectation;
};

// Helper functions

const assertMatcher = (
	pass: boolean,
	isNot: boolean,
	message: string,
	notMessage: string,
): void => {
	const shouldPass = isNot ? !pass : pass;
	const errorMessage = isNot ? notMessage : message;
	tg.assert(shouldPass, errorMessage);
};

const formatValue = (value: any): string => {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return `"${value}"`;
	if (typeof value === "function")
		return `[Function: ${value.name || "anonymous"}]`;
	if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
	if (typeof value === "object") {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}
	return String(value);
};

const deepEqual = (a: any, b: any): boolean => {
	if (Object.is(a, b)) return true;
	if (a === null || b === null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;

	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, i) => deepEqual(item, b[i]));
	}

	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;

	return keysA.every((key) => keysB.includes(key) && deepEqual(a[key], b[key]));
};

const matchesSubset = (obj: any, subset: any): boolean => {
	for (const key in subset) {
		if (!(key in obj)) return false;
		if (!deepEqual(obj[key], subset[key])) return false;
	}
	return true;
};

const matchesError = (
	error: any,
	expected: string | RegExp | Error,
): boolean => {
	if (typeof expected === "string") {
		return (
			error.message?.includes(expected) || String(error).includes(expected)
		);
	}
	if (expected instanceof RegExp) {
		return expected.test(error.message || String(error));
	}
	if (expected instanceof Error) {
		return (
			error.constructor === expected.constructor &&
			error.message === expected.message
		);
	}
	return false;
};

const normalizeSnapshotString = (string: string): string => {
	// Split the lines.
	let lines = string.split("\n");

	// Remove the first and last lines if they're empty.
	if (lines.length > 0 && lines[0].trim() === "") {
		lines = lines.slice(1);
	}
	if (lines.length > 0 && lines[lines.length - 1].trim() === "") {
		lines = lines.slice(0, -1);
	}

	// Get the number of leading tabs to remove.
	let leadingTabsCount = Math.min(
		...lines
			.filter((line) => line.length > 0)
			.map((line) => line.search(/[^\t]|$/)),
	);

	// Remove the leading tabs from each line and combine them with newlines.
	return lines.map((line) => line.slice(leadingTabsCount)).join("\n");
};

// Test organization functions

export type TestFn = () => void | Promise<void>;
export type DescribeBlock = {
	description: string;
	tests: Array<TestCase>;
	beforeEach?: TestFn;
	afterEach?: TestFn;
};

export type TestCase = {
	description: string;
	fn: TestFn;
	skip?: boolean;
	only?: boolean;
};

/** Describe a test suite (stub - implementation TBD). */
export const describe = (description: string, fn: () => void): void => {
	throw new Error("describe() not yet implemented - use for organization only");
};

/** Define a test case (stub - implementation TBD). */
export const it = (description: string, fn: TestFn): void => {
	throw new Error("it() not yet implemented - use for organization only");
};

/** Skip a test case (stub - implementation TBD). */
export const skip = (description: string, fn: TestFn): void => {
	throw new Error("skip() not yet implemented");
};

/** Run only this test case (stub - implementation TBD). */
export const only = (description: string, fn: TestFn): void => {
	throw new Error("only() not yet implemented");
};

/** Run function before each test in a describe block (stub - implementation TBD). */
export const beforeEach = (fn: TestFn): void => {
	throw new Error("beforeEach() not yet implemented");
};

/** Run function after each test in a describe block (stub - implementation TBD). */
export const afterEach = (fn: TestFn): void => {
	throw new Error("afterEach() not yet implemented");
};

export let normalizeWhitespace = (
	strings: TemplateStringsArray,
	...placeholders: Array<string>
): string => {
	// Concatenate the strings and placeholders.
	let string = "";
	let i = 0;
	while (i < placeholders.length) {
		string += strings[i];
		string += placeholders[i];
		i = i + 1;
	}
	string += strings[i];

	// Split the lines.
	let lines = string.split("\n");

	// Remove the first and last lines.
	lines = lines.slice(1, -1);

	// Get the number of leading tabs to remove.
	let leadingTabsCount = Math.min(
		...lines
			.filter((line) => line.length > 0)
			.map((line) => line.search(/[^\t]|$/)),
	);

	// Remove the leading tabs from each line and combine them with newlines.
	string = lines.map((line) => line.slice(leadingTabsCount)).join("\n");

	return string;
};

// Test case for toMatchJsonSnapshot with doc()
export let test = async () => {
	const data = {
		name: "test-package",
		version: "1.0.0",
		dependencies: ["foo", "bar"],
		metadata: {
			author: "Test Author",
			license: "MIT",
		},
	};

	// Test successful match - whitespace normalization happens automatically
	expect(data).toMatchJsonSnapshot(`
		{
			"name": "test-package",
			"version": "1.0.0",
			"dependencies": [
				"foo",
				"bar"
			],
			"metadata": {
				"author": "Test Author",
				"license": "MIT"
			}
		}
	`);

	// Test negation - should pass because data doesn't match different structure
	expect(data).not.toMatchJsonSnapshot(`
		{
			"name": "different-package",
			"version": "2.0.0"
		}
	`);

	return true;
};
