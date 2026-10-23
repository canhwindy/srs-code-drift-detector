import env from "@server/env";
import type BaseStorage from "./BaseStorage";
import GCSStorage from "./GCSStorage";
import LocalStorage from "./LocalStorage";
import S3Storage from "./S3Storage";

let storage: BaseStorage;

switch (env.FILE_STORAGE) {
  case "local":
    storage = new LocalStorage();
    break;
  case "gcs":
    storage = new GCSStorage();
    break;
  case "s3":
  default:
    storage = new S3Storage();
    break;
}

export default storage;
