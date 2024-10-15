import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

/** Check if the script was called with an argument. If so, process just that package. If not, run all. */
const entrypoint = async () => {
  const numArgs = process.argv.length;

  // Determine action.
  if (numArgs < 3) {
    throw new Error("Not enough args");
  }
  const action = validateAction(process.argv[2]);

  // Determine target.
  if (numArgs === 3) {
    // No package name was given.
    await processAll(action);
  } else if (numArgs === 4) {
    let packageName = process.argv[3];
    log("running single package:", packageName);
    let result = await processPackage(packageName, action);
    log(result);
  } else {
    throw usageError("Too many args");
  }  
}

const usageError = (message: string) => new Error(`${message}\nUsage: bun scripts/package_automation.ts <buildPush|tag|test> or bun scripts/package_automation.ts <buildPush|tag|test> <packageName>`);

const log = (...message: Array<any>) => {
  const currentDate = '[' + new Date().toUTCString() + '] ';
  console.log(currentDate, ...message);
}

/** The available actions:
*
* - buildPush: build the default target, and push if successful.
* - tag: check for an existing tag for this directory, tag and push if not present.
* - test: build the test target.
*/
type Action = "buildPush" | "tag" | "test";

const validateAction = (s: string): Action => {
  switch (s) {
    case "buildPush":
    case "tag":
    case "test": {
      return s;
    }
    default: {
      throw usageError(`unrecognized action ${s}`)
    }
  }
}

/** Tag and push all supported packages, reporting failures. */
const processAll = async (action: Action) => {
  const results: { [key: string]: Result } = await allPackageNames().reduce( async (acc, name) => {
    const result = await processPackage(name, action);
    let acc_ = await acc;
    acc_[name] = result;
    return acc_;
  }, Promise.resolve({}) as Promise<{ [key: string]: Result }>);
  
  // Report results.
 log(results);
}

/** Get the names of every directory in the packages repo with a tangram.ts. */
export const allPackageNames = () => {
  const entries = fs.readdirSync(packagesPath(), { withFileTypes: true });
  const results: Array<string> = [];

  for (const entry of entries) {
    const fullPath = path.join(packagesPath(), entry.name);
    if (entry.isDirectory()) {
      // Check if it has a root module.
      if (fs.existsSync(path.join(fullPath, "tangram.ts"))) {
        results.push(entry.name);
      }
    }
  }

  return results;
}

/** Produce the path containing all the package definitions. */
const packagesPath = () => path.join(path.dirname(import.meta.dir), "packages");

/** Produce the path to a package in the packages repo by name. Assumes this script lives in <packages repo>/scripts. */
export const getPackagePath = (name: string) => path.join(packagesPath(), name);

/** Ensuring the given package test succeeds, then ensure it is tagged and pushed along with the default target build. */
const processPackage = async (name: string, action: Action): Promise<Result> => {  
  let path = getPackagePath(name);
  log(`processing action ${action} for ${name}: ${path}`);

  let result: Result | undefined;
  switch (action) {
    case "buildPush": {
      result = await buildPushAction(path);
      break;
    }
    case "tag": {
      result = await tagAction(name, path);
      break;
    }
    case "test": {
      result = await testAction(path);
      break;
    }
  }
  if (result === undefined) {
    throw new Error(`no result logged ${name} ${path}`);
  }
  return result;
}

/** Perform the `buildPush` action. Built the default target. If successful, push that build. */
const buildPushAction = async (path: string) => {
  // // Build the default target by tag, storing the ID.
  let buildId = await buildDefaultTarget(path);
  if (buildId === "buildError") {
    return "buildError";
  }

  // Push the build from the default target.
  let pushBuildResult = await push(buildId);
  if (pushBuildResult !== "ok") {
    return pushBuildResult;
  }

  return "ok";
}

/** Perform the `tag` action for a package name. If the existing tag is out of date, tag and push the new package. */
const tagAction = async (name: string, path: string) => {
  // Check in the package, store the ID.
  let packageId = await checkinPackage(path);
  if (packageId === "checkinError") {
    return "checkinError";
  }

  // Look up the existing tag for the given name.
  let existingTag = await existingTaggedItem(name);
  
  // If there is no tag or the ID does not match, tag the package.
  if (packageId !== existingTag) {
    log(`tagging ${name}...`);
    let tagResult = await tagPackage(name, path);
    if (tagResult !== "ok") {
      return tagResult;
    }
    
    // Push the tag.
    let pushTagResult = await push(name);
    if (pushTagResult !== "ok") {
      return pushTagResult;
    }
  } else {
    log(`matching tag found for ${name}, not re-tagging.`);
  }
  return "ok";
}

/** Build the test target for a package. On success, build and push the default target. */
const testAction = async (path: string) => {
  // Build the test target.
  let testResult = await buildTestTarget(path);
  if (testResult === "testError") {
    return "testError";
  }

  return "ok";
}

/** Check in a package, returning the resulting ID or "checkinError" on failure. */
const checkinPackage = async (path: string) => {
  log("checking in", path);
  try {
    let result = await $`tg checkin ${path}`.text().then((t) => t.trim());
    return result;
  } catch (err) {
    return "checkinError";
  }
}

/** Get the existing tagged item for a given name, if present. */
const existingTaggedItem = async (name: string) => {
  log("checking for existing tag", name);
  try {
    let result = await $`tg tag get ${name}`.text().then((t) => t.trim());
    return result;
  } catch (err) {
    return "not found";
  }
}

/** Tag a package at the given path with the given name. */
const tagPackage = async (name: string, path: string): Promise<Result> => {
  log("tagging", name, path);
  try {
    let _result = await $`tg tag ${name} ${path}`.quiet();
    return "ok";
  } catch (err) {
    return "tagError";
  }
}

/** Push something. */
const push = async (arg: string): Promise<Result> => {
  log("pushing", arg);
  try {
    await $`tg push ${arg}`.quiet();
  } catch (err) {
    return "pushError";
  }
  return "ok";
}

/** Build the default target given a tag. Return the build ID. */
const buildDefaultTarget = async (path: string) => {
  let buildId: string;
  try {
    buildId = await $`tg build ${path} -d`.text().then((t) => t.trim());
    log(`building ${path}: ${buildId}`);
    await $`tg build output ${buildId}`.quiet();
  } catch (err) {
    return "buildError";
  }
  if (buildId === undefined) {
    return "buildError";
  }
  return buildId;
}

/** Build the default target given a tag. Return the build ID. */
const buildTestTarget = async (path: string) => {
  try {
    let buildId = await $`tg build ${path}#test -d`.text().then((t) => t.trim());
    log(`building ${path}#test: ${buildId}`);
    await $`tg build output ${buildId}`.quiet();
  } catch (err) {
    return "testError";
  }
  return "ok";
}

export type Result = "ok" | "checkinError" | "testError" | "tagError" | "pushError" | "buildError";

await entrypoint();
