import { existsSync, mkdirSync } from "fs";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import {
  PluginManager,
  PluginPriority,
  Hook,
} from "@server/utils/PluginManager";
import router from "./api/files";

if (env.FILE_STORAGE === "local") {
  const rootDir = env.FILE_STORAGE_LOCAL_ROOT_DIR;
  try {
    if (!existsSync(rootDir)) {
      mkdirSync(rootDir, { recursive: true });
      Logger.debug("utils", `Created ${rootDir} for local storage`);
    }
  } catch (err) {
    Logger.fatal(
      `Failed to create directory for local file storage at ${env.FILE_STORAGE_LOCAL_ROOT_DIR}`,
      err
    );
  }
}

// Enable the storage plugin for both local and GCS storage.
// GCS uploads go through the server (like local) to avoid CORS issues
// with direct browser-to-GCS uploads.
const enabled = !!(
  env.FILE_STORAGE_UPLOAD_MAX_SIZE &&
  (env.FILE_STORAGE === "local" || env.FILE_STORAGE === "gcs")
);

if (enabled) {
  PluginManager.add([
    {
      name: "File storage",
      description: "Plugin for storing files via local filesystem or GCS",
      type: Hook.API,
      value: router,
      priority: PluginPriority.Normal,
    },
  ]);
}
