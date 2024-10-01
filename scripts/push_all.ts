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
  // Create container to store results.
  let results = {};

  // Run.
  let m4Result = await processPackage("m4");
  results["m4"] = m4Result;
  
  let zlibResult = await processPackage("zlib");
  results["zlib"] = zlibResult;

  // Report results.
 console.log(results);
}

/** Produce the path to a package in the packages repo by name. Assumes this script lives in <packages repo>/scripts. */
const getPackagePath = (name: string) => {
  return path.join(path.dirname(import.meta.dir), "packages", name);
}

/** Ensuring the given package test succeeds, then ensure it is tagged and pushed along with the default target build. */
const processPackage = async (name: string): Promise<Result> => {
  let path = getPackagePath(name);
  console.log(`processing ${name}: ${path}`);

  // Make sure the test target succeeds.
  let testResult = await buildTestTarget(path);
  if (testResult !== "ok") {
    return testResult;
  }

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

  // Build the default target by tag, storing the ID.
  let buildId = await buildDefaultTarget(name);
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


/** Run the test target for a given package. */
const buildTestTarget = async (path: string): Promise<Result> => {
  console.log("testing:", path);
  try {
    let result = await $`tg build ${path}#test --quiet`.text();
    if (!result.includes("true")) {
      console.error(`${path}: test target failed`);
      return "testError";
    } else {
      return "ok";
    }
  } catch (err) {
    console.error(`${path} test: failed with code ${err.exitCode}`);
    console.error(err.stdout.toString());
    console.error(err.stderr.toString());
    return "testError";
  }
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
    let output = await $`tg build ${name}`.text();

    // Pull out the build ID from the output.
    const match = output.match(/\bbld_\w+/);
    return match ? match[0] : "buildError";
  } catch (err) {
    return "buildError";
  }
}

type Result = "ok" | "checkinError" | "testError" | "tagError" | "pushError" | "buildError";

await entrypoint();
