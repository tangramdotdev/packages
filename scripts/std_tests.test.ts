import { expect, test } from "bun:test";

const source = await Bun.file(`${import.meta.dir}/../packages/std/tangram.ts`).text();
const body = source.slice(
	source.indexOf("export async function test("),
	source.indexOf("\nexport async function buildGnuEnv("),
).replace("export ", "");
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(body);
const create = new Function("testModules", "testTiers", "tg", "console", `
	const tiers = ["bootstrap", "sdk", "extended"];
	${javascript}
	return test;
`);

type Tier = "bootstrap" | "sdk" | "extended";
type Module = [Record<string, unknown>, Tier];

class StoredError {
	constructor(private fail = false) {}
	async store() {
		if (this.fail) throw new Error("the error store is unavailable");
		return "err_example";
	}
}

function harness(modules: Record<string, Module>, overrides: Record<string, Tier> = {}) {
	const started: Array<string> = [];
	const tg = {
		Error: StoredError,
		build: (fn: () => unknown) => ({
			named: (name: string) => Promise.resolve().then(() => {
				started.push(name);
				return fn();
			}),
		}),
	};
	return { run: create(modules, overrides, tg, { log() {} }), started };
}

function plan(...paths: Array<string>) {
	const modules: Record<string, Module> = {};
	const overrides: Record<string, Tier> = {};
	for (const path of paths) {
		modules[path] = [{ testBootstrap: () => true, testSdk: () => true, testExtended: () => true }, "bootstrap"];
		overrides[`${path}#testSdk`] = "sdk";
		overrides[`${path}#testExtended`] = "extended";
	}
	return harness(modules, overrides);
}

test("the default runs bootstrap and SDK but leaves extended opt-in", async () => {
	const { run, started } = plan("one.tg.ts");
	await run();
	expect(started).toEqual(["one.tg.ts#testBootstrap", "one.tg.ts#testSdk"]);
});

test("listing all tests includes every tier without executing anything", async () => {
	const { run, started } = plan("one.tg.ts");
	expect(await run("list", "all")).toEqual({
		bootstrap: ["one.tg.ts#testBootstrap"],
		sdk: ["one.tg.ts#testSdk"],
		extended: ["one.tg.ts#testExtended"],
	});
	expect(started).toEqual([]);
});

test("tier unions intersect path unions without duplicate execution", async () => {
	const { run, started } = plan("one/a.tg.ts", "two/b.tg.ts");
	await run("bootstrap", "extended", "one", "one/a", "bootstrap");
	expect(started).toEqual(["one/a.tg.ts#testBootstrap", "one/a.tg.ts#testExtended"]);
});

test("invalid filters and empty intersections fail before executing tests", async () => {
	const { run, started } = harness({ "one.tg.ts": [{ test: () => true }, "bootstrap"] });
	await expect(run("unknown")).rejects.toThrow("unrecognized test filter");
	await expect(run("extended", "one")).rejects.toThrow("no tests match");
	expect(started).toEqual([]);
});

test("new test exports inherit the module tier without a registration entry", async () => {
	const { run, started } = harness({ "one.tg.ts": [{
		test: () => true, testAdded: () => true, helper: () => true, testData: 42,
	}, "sdk"] });
	expect(await run("list", "sdk")).toEqual({ sdk: ["one.tg.ts#test", "one.tg.ts#testAdded"] });
	await run();
	expect(started).toEqual(["one.tg.ts#test", "one.tg.ts#testAdded"]);
});

test.each(["stale override", "invalid default", "invalid override"])("%s is rejected before executing tests", async (kind) => {
	const entry: Module = [{ test: () => true }, "bootstrap"];
	const overrides: Record<string, Tier> = {};
	if (kind === "stale override") overrides["one.tg.ts#testRemoved"] = "extended";
	if (kind === "invalid default") entry[1] = "unknown" as Tier;
	if (kind === "invalid override") overrides["one.tg.ts#test"] = "unknown" as Tier;
	const { run, started } = harness({ "one.tg.ts": entry }, overrides);
	await expect(run("bootstrap")).rejects.toThrow("invalid test registration");
	expect(started).toEqual([]);
});

test("tests within a tier overlap and finish before the next tier starts", async () => {
	const ready = Promise.withResolvers<void>();
	let pending = 2;
	let completed = 0;
	const wait = async () => {
		if (--pending === 0) ready.resolve();
		await ready.promise;
		completed++;
	};
	const testFirst = () => wait();
	const testSecond = () => wait();
	const testNext = () => expect(completed).toBe(2);
	const { run } = harness({ "one.tg.ts": [{ testFirst, testSecond, testNext }, "bootstrap"] }, {
		"one.tg.ts#testNext": "sdk",
	});
	await run();
});

test("all failures are reported and later tiers are stopped", async () => {
	const testFirst = () => { throw new Error("first failure"); };
	const testSecond = () => { throw new Error("second failure"); };
	const testNext = () => true;
	const { run, started } = harness({ "one.tg.ts": [{ testFirst, testSecond, testNext }, "bootstrap"] }, {
		"one.tg.ts#testNext": "sdk",
	});
	const error = await run().catch((error: unknown) => error);
	expect(error).toBeInstanceOf(AggregateError);
	expect(error.message).toContain("one.tg.ts#testFirst: Error: first failure");
	expect(error.message).toContain("one.tg.ts#testSecond: Error: second failure");
	expect(error.errors).toHaveLength(2);
	expect(started).toHaveLength(2);
});

test("an error-storage failure does not hide other test failures", async () => {
	const testFirst = () => { throw new StoredError(true); };
	const testSecond = () => { throw new StoredError(); };
	const { run } = harness({ "one.tg.ts": [{ testFirst, testSecond }, "bootstrap"] });
	const error = await run().catch((error: unknown) => error);
	expect(error.errors).toHaveLength(2);
	expect(error.message).toContain("one.tg.ts#testFirst");
	expect(error.message).toContain("the error store is unavailable");
	expect(error.message).toContain("one.tg.ts#testSecond: error: err_example");
});
