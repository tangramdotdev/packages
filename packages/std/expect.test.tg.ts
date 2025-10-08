/** Example tests demonstrating the expect assertion library. */

import { expect } from "./expect.tg.ts";

/** Test basic equality matchers. */
export const testEquality = () => {
	// Strict equality
	expect(42).toBe(42);
	expect("hello").toBe("hello");
	expect(true).toBe(true);

	// Negation
	expect(42).not.toBe(43);
	expect("hello").not.toBe("world");

	// Deep equality
	expect([1, 2, 3]).toEqual([1, 2, 3]);
	expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });

	// Truthy/Falsy
	expect(1).toBeTruthy();
	expect("hello").toBeTruthy();
	expect(0).toBeFalsy();
	expect("").toBeFalsy();

	// Null/Undefined
	expect(null).toBeNull();
	expect(undefined).toBeUndefined();
	expect(42).toBeDefined();
	expect(42).not.toBeNull();

	return true;
};

/** Test numeric matchers. */
export const testNumeric = () => {
	expect(10).toBeGreaterThan(5);
	expect(10).toBeGreaterThanOrEqual(10);
	expect(5).toBeLessThan(10);
	expect(5).toBeLessThanOrEqual(5);
	expect(0.1 + 0.2).toBeCloseTo(0.3);

	return true;
};

/** Test string matchers. */
export const testString = () => {
	expect("hello world").toContain("world");
	expect("hello world").toMatch(/world/);
	expect("hello world").toStartWith("hello");
	expect("hello world").toEndWith("world");

	expect("hello").not.toContain("xyz");
	expect("hello").not.toMatch(/xyz/);

	return true;
};

/** Test array matchers. */
export const testArray = () => {
	expect([1, 2, 3]).toContainItem(2);
	expect([1, 2, 3]).toContainAllItems([1, 3]);
	expect([1, 2, 3]).toHaveLength(3);
	expect([]).toBeEmpty();
	expect([1]).not.toBeEmpty();

	return true;
};

/** Test object matchers. */
export const testObject = () => {
	const obj = { a: 1, b: 2, c: 3 };

	expect(obj).toHaveProperty("a");
	expect(obj).toHaveProperty("a", 1);
	expect(obj).toMatchObject({ a: 1, b: 2 });
	expect({}).toBeEmpty();

	return true;
};

/** Test function matchers. */
export const testFunction = () => {
	const throwingFn = () => {
		throw new Error("test error");
	};

	expect(throwingFn).toThrow();
	expect(throwingFn).toThrow("test error");
	expect(throwingFn).toThrow(/test/);

	const nonThrowingFn = () => {
		return 42;
	};
	expect(nonThrowingFn).not.toThrow();

	return true;
};

/** Test async function matchers. */
export const testAsync = async () => {
	const rejectingPromise = Promise.reject(new Error("test error"));
	await expect(rejectingPromise).toReject();
	await expect(rejectingPromise).toReject("test error");

	const resolvingPromise = Promise.resolve(42);
	await expect(resolvingPromise).not.toReject();

	return true;
};

/** Test Tangram-specific matchers. */
export const testTangram = async () => {
	const file = tg.file("test content");
	const dir = tg.directory({
		"test.txt": file,
	});

	expect(file).toBeArtifact();
	expect(file).toBeFile();
	expect(dir).toBeDirectory();

	await expect(dir).toExistAt("test.txt");
	await expect(dir).not.toExistAt("nonexistent.txt");

	return true;
};

/** Run all example tests. */
export const test = async () => {
	testEquality();
	testNumeric();
	testString();
	testArray();
	testObject();
	testFunction();
	await testAsync();
	await testTangram();

	console.log("All expect tests passed!");
	return true;
};
