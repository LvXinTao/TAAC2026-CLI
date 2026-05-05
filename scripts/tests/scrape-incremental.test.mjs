import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldSkipJobDeepSync } from "../scrape-taiji.mjs";

test("incremental sync skips unchanged terminal jobs with complete cached data", () => {
  const current = {
    updateTime: "2026-05-05T17:06:54+08:00",
    status: "SUCCEED",
    jzStatus: "END",
    code: { files: 3, saved: 3 },
    instancesById: {
      instance_a: { error: null, metrics: { auc: {} }, log: { lines: 10 } },
    },
  };
  const listed = {
    taskID: "job_a",
    id: 123,
    updateTime: "2026-05-05T17:06:54+08:00",
    status: "SUCCEED",
    jzStatus: "END",
  };

  assert.deepEqual(shouldSkipJobDeepSync(current, listed, { incremental: true }), {
    skip: true,
    reason: "unchanged_terminal_job",
  });
});

test("incremental sync refreshes changed, running, or incomplete cached jobs", () => {
  const complete = {
    updateTime: "2026-05-05T17:06:54+08:00",
    status: "SUCCEED",
    jzStatus: "END",
    code: { files: 3, saved: 3 },
    instancesById: {
      instance_a: { error: null, metrics: { auc: {} }, log: { lines: 10 } },
    },
  };

  assert.equal(
    shouldSkipJobDeepSync(
      complete,
      { taskID: "job_a", updateTime: "2026-05-05T18:00:00+08:00", status: "SUCCEED", jzStatus: "END" },
      { incremental: true },
    ).skip,
    false,
  );
  assert.equal(
    shouldSkipJobDeepSync(
      complete,
      { taskID: "job_a", updateTime: complete.updateTime, status: "RUNNING", jzStatus: "RUNNING" },
      { incremental: true },
    ).skip,
    false,
  );
  assert.equal(
    shouldSkipJobDeepSync(
      { ...complete, code: { error: "previous fetch failed" } },
      { taskID: "job_a", updateTime: complete.updateTime, status: "SUCCEED", jzStatus: "END" },
      { incremental: true },
    ).skip,
    false,
  );
  assert.equal(
    shouldSkipJobDeepSync(
      complete,
      { taskID: "job_a", updateTime: complete.updateTime, status: "SUCCEED", jzStatus: "END" },
      { incremental: false },
    ).skip,
    false,
  );
});
