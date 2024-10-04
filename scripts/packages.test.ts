import { describe, test, expect } from "bun:test"
import { $ } from "bun";
import { allPackageNames, getPackagePath } from "./push_all";

/** Run the test target for a given package. */
const buildTestTarget = async (path: string) => {
  try {
    let result = await $`tg build ${path}#test --quiet`.text();
    if (!result.includes("true")) {
      console.error(`${path}: test target failed`);
      return "testError";
    } else {
      return "ok";
    }
  } catch (err) {
    return { code: err.exitCode, stdout: err.stdout.toString(), stderr: err.stdout.toString() };
  }
}

describe("test targets", () => {
  allPackageNames().forEach((name) => {
    test(name, async () => {
      const path = getPackagePath(name);
      const result = await buildTestTarget(path);
      expect(result).toBe("ok");
    })
  })
});
