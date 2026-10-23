/* oxlint-disable no-console */
/* oxlint-disable @typescript-oxlint/no-var-requires */
/* oxlint-disable no-undef */
const { exec } = require("child_process");
const { readdirSync, existsSync } = require("fs");

const getDirectories = (source) =>
  readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
  });
}

async function build() {
  // Clean previous build
  console.log("Clean previous build…");

  const isWindows = process.platform === "win32";
  if (isWindows) {
    const { rmSync } = require("fs");
    if (existsSync("./build/server")) rmSync("./build/server", { recursive: true, force: true });
    if (existsSync("./build/plugins")) rmSync("./build/plugins", { recursive: true, force: true });
  } else {
    await Promise.all([
      execAsync("rm -rf ./build/server"),
      execAsync("rm -rf ./build/plugins"),
    ]);
  }

  const d = getDirectories("./plugins");

  // Compile server and shared
  console.log("Compiling…");
  await Promise.all([
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/server ./server"
    ),
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/shared ./shared"
    ),
  ]);

  for (const plugin of d) {
    const hasServer = existsSync(`./plugins/${plugin}/server`);

    if (hasServer) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/server" "./plugins/${plugin}/server"`
      );
    }

    const hasShared = existsSync(`./plugins/${plugin}/shared`);

    if (hasShared) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/shared" "./plugins/${plugin}/shared"`
      );
    }
  }

  // Copy static files
  console.log("Copying static files…");
  
  const { copyFileSync, mkdirSync } = require("fs");
  const path = require("path");
  
  // Helper function for cross-platform copy
  const copyFile = (src, dest) => {
    const destDir = path.dirname(dest);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    if (existsSync(src)) {
      copyFileSync(src, dest);
    }
  };
  
  // Copy static files
  copyFile("./server/collaboration/Procfile", "./build/server/collaboration/Procfile");
  copyFile("./server/static/error.dev.html", "./build/server/error.dev.html");
  copyFile("./server/static/error.prod.html", "./build/server/error.prod.html");
  copyFile("./package.json", "./build/package.json");
  
  // Copy plugin.json for each plugin
  for (const plugin of d) {
    const pluginJsonSrc = `./plugins/${plugin}/plugin.json`;
    const pluginJsonDest = `./build/plugins/${plugin}/plugin.json`;
    copyFile(pluginJsonSrc, pluginJsonDest);
  }

  console.log("Done!");
}

void build();
