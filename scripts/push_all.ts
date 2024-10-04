import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

/** Check if the script was called with an argument. If so, process just that package. If not, run all. */
const entrypoint = async () => {
  const numArgs = process.argv.length;
  if (numArgs === 2) {
    // No package name was given.
    await doAll();
  } else if (numArgs === 3) {
    let packageName = process.argv[2];
    console.log("running single package:", packageName);
    let result = await processPackage(packageName);
    console.log(result);
  } else {
    console.error("Too many args\nUsage: bun scripts/push_all.ts or bun scripts/push_all.ts <packageName>");
  }
  
  console.log(process.argv);
}

/** Tag and push all supported packages, reporting failures. */
const doAll = async () => {
  const results: { [key: string]: Result } = await allPackageNames().reduce( async (acc, name) => {
    const result = await processPackage(name);
    let acc_ = await acc;
    acc_[name] = result;
    return acc_;
  }, Promise.resolve({}) as Promise<{ [key: string]: Result }>);
  
  // Report results.
 console.log(results);
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
const processPackage = async (name: string): Promise<Result> => {  
  let path = getPackagePath(name);
  console.log(`processing ${name}: ${path}`);

  // Check in the package, store the ID.
  let packageId = await checkinPackage(path);
  if (packageId === "checkinError") {
    return "checkinError";
  }

  // Look up the existing tag for the given name.
  let existingTag = await existingTaggedItem(name);
  
  // If there is no tag or the ID does not match, tag the package.
  if (packageId !== existingTag) {
    console.log(`tagging ${name}...`);
    let tagResult = await tagPackage(name, path);
    if (tagResult !== "ok") {
      return tagResult;
    }
  } else {
    console.log(`matching tag found for ${name}, not re-tagging.`);
  }

  // Push the tag.
  let pushTagResult = await push(name);
  if (pushTagResult !== "ok") {
    return pushTagResult;
  }

  // // Build the default target by tag, storing the ID.
  // let buildId = await buildDefaultTarget(name);
  // if (buildId === "buildError") {
  //   return "buildError";
  // }

  // // Push the build from the default target.
  // let pushBuildResult = await push(buildId);
  // if (pushBuildResult !== "ok") {
  //   return pushBuildResult;
  // }

  return "ok";
}

/** Check in a package, returning the resulting ID or "checkinError" on failure. */
const checkinPackage = async (path: string) => {
  console.log("checking in", path);
  try {
    let result = await $`tg checkin ${path}`.text().then((t) => t.trim());
    return result;
  } catch (err) {
    return "checkinError";
  }
}

/** Get the existing tagged item for a given name, if present. */
const existingTaggedItem = async (name: string) => {
  console.log("checking for existing tag", name);
  try {
    let result = await $`tg tag get ${name}`.text().then((t) => t.trim());
    return result;
  } catch (err) {
    return "not found";
  }
}

/** Tag a package at the given path with the given name. */
const tagPackage = async (name: string, path: string): Promise<Result> => {
  console.log("tagging", name, path);
  try {
    let _result = await $`tg tag ${name} ${path}`.quiet();
    return "ok";
  } catch (err) {
    return "tagError";
  }
}

/** Push something. */
const push = async (arg: string): Promise<Result> => {
  console.log("pushing", arg);
  try {
    let _result = await $`tg push ${arg}`.quiet();
    return "ok";
  } catch (err) {
    return "pushError";
  }
}

/** Build the default target given a tag. Return the build ID. */
const buildDefaultTarget = async (name: string) => {
  console.log("building default target for tag", name);
  try {
    let output = await $`tg build ${name} 2>&1`.text();

    // Pull out the build ID from the output.
    const match = output.match(/\bbld_\w+/);
    return match ? match[0] : "buildError";
  } catch (err) {
    return "buildError";
  }
}

export type Result = "ok" | "checkinError" | "testError" | "tagError" | "pushError" | "buildError";

await entrypoint();
