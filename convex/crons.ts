import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "refresh-displayed-profiles",
  { hours: 1 },
  internal.profiles.refreshDisplayedProfiles,
  {},
);

export default crons;
