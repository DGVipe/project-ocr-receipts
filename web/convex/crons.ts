import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("prune old scan events", { minuteUTC: 0 }, internal.scans.pruneOldEvents, {});

export default crons;
