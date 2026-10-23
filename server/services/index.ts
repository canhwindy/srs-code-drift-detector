import admin from "./admin";
import collaboration from "./collaboration";
import cron from "./cron";
import gapFindingConsumer from "./gapFindingConsumer";
import outboxRelay from "./outboxRelay";
import web from "./web";
import websockets from "./websockets";
import worker from "./worker";

export default {
  websockets,
  collaboration,
  admin,
  web,
  worker,
  cron,
  gapfindingconsumer: gapFindingConsumer,
  outboxrelay: outboxRelay,
} as const;
