import env from "~/env";

/**
 * True if the current installation is not running on localhost.
 * Mirrors the server-side isCloudHosted logic in server/env.ts.
 */
const isCloudHosted = !["http://localhost:3000"].includes(env.URL);

export default isCloudHosted;
