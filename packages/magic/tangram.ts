// import * as std from "tg:std" with { path: "../std" };

export const metadata = {
  name: "magic",
  version: "0.0.0",
};

export type Arg = {
  source: tg.Directory;
};

export const build = tg.target(async (arg: Arg) => {
  const { source } = arg;
  const sourceId = await source.id();
  console.log("received source dir", sourceId);
  const variant = detectVariant(source);
  return variant;
});

export default build;

export type Variant = "cc-autotools" | "cmake" | "js" | "rust-cargo" | "unknown";

export const detectVariant = async (source: tg.Directory): Promise<Variant> => {
  const entries = await source.entries();

  // Check for existence of known project files, returning on first match.

  // Check for a Cargo project.
  if (entries.hasOwnProperty("Cargo.toml")) {
    // Ensure it's a file
    const cargoToml = entries["Cargo.toml"];
    if (cargoToml instanceof tg.File) {
      return "rust-cargo";
    }
  }

  // Check for a CMake project.
  if (entries.hasOwnProperty("CMakeLists.txt")) {
    // Ensure it's a file.
    const cmakeListsTxt = entries["CMakeLists.txt"];
    if (cmakeListsTxt instanceof tg.File) {
      return "cmake";
    }
  }
  
  // Check for an Autotools project with an executable configure script.
  if (entries.hasOwnProperty("configure")) {
    // Ensure it's a file.
    const configureScript = entries["configure"];
    if (configureScript instanceof tg.File) {
      // Ensure it's executable.
      if (configureScript.executable()) {
        return "cc-autotools";
      }
    }
  }

  // Check for a package.json.
  if (entries.hasOwnProperty("package.json")) {
    // Ensure it's a file.
    const packageJson = entries["package.json"];
    if (packageJson instanceof tg.File) {
      return "js";
    }
  }
  
  // We didn't match any known types.
  return "unknown";
}
