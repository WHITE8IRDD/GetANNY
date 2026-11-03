const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TrackerListService,
  parseTrackerList,
  validTracker,
  DEFAULT_TRACKERS,
  REFRESH_MS,
} = require("./TrackerListService");

test("tracker lists accept supported public endpoints and remove duplicates", () => {
  const parsed = parseTrackerList(
    "udp://tracker.example:80/announce\nhttps://tracker.example/announce\nudp://tracker.example:80/announce",
  );
  assert.deepEqual(parsed, [
    "udp://tracker.example:80/announce",
    "https://tracker.example/announce",
  ]);
  assert.equal(validTracker("http://127.0.0.1/announce"), false);
  assert.equal(validTracker("udp://[fd00::1]:80/announce"), false);
  assert.equal(validTracker("udp://[::1]:80/announce"), false);
  assert.equal(validTracker("file:///private"), false);
  assert.throws(() => parseTrackerList("localhost\n127.0.0.1"));
});

test("tracker refresh is coalesced and falls back to defaults on invalid data", async () => {
  let calls = 0;
  const service = new TrackerListService({
    now: () => 100,
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        text: async () => "udp://fresh.example:80/announce",
      };
    },
  });
  const [first, second] = await Promise.all([
    service.refresh(),
    service.refresh(),
  ]);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(calls, 1);
  assert.deepEqual(service.getTrackers(), ["udp://fresh.example:80/announce"]);
  assert.equal(service.updatedAt, 100);
  assert.equal(REFRESH_MS, 24 * 60 * 60 * 1000);
  assert.equal(DEFAULT_TRACKERS.length, 8);
  service.close();
});
