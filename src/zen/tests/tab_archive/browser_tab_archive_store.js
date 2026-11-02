/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

function makeRecord(id, overrides = {}) {
  return {
    id,
    url: `https://example.com/?${id}`,
    title: id,
    archivedAt: Date.now(),
    lastActivity: Date.now(),
    reason: "auto",
    ...overrides,
  };
}

add_task(async function test_removal_leaves_a_tombstone_for_sync() {
  await ZenTabArchiveStore.addRecords([makeRecord("store-a")]);
  ok("store-a" in ZenTabArchiveStore.getDirty(), "a new record waits for Sync");
  ZenTabArchiveStore.markUploaded(["store-a"], ZenTabArchiveStore.getDirty());

  await ZenTabArchiveStore.removeRecords(["store-a"]);
  ok(!ZenTabArchiveStore.getRecord("store-a"), "the record is gone");
  ok(
    "store-a" in ZenTabArchiveStore.getTombstones(),
    "other devices will hear it was removed"
  );
});

add_task(async function test_discarding_an_unsynced_record_leaves_no_trace() {
  await ZenTabArchiveStore.addRecords([makeRecord("store-b")]);
  await ZenTabArchiveStore.removeRecords(["store-b"], { discard: true });
  ok(
    !("store-b" in ZenTabArchiveStore.getTombstones()),
    "a record no other device has seen leaves no tombstone"
  );
  ok(!("store-b" in ZenTabArchiveStore.getDirty()), "and nothing to upload");
});

add_task(async function test_records_from_sync_are_not_sent_back() {
  await ZenTabArchiveStore.addRecords([makeRecord("store-c")], {
    fromSync: true,
  });
  ok(ZenTabArchiveStore.getRecord("store-c"), "the record is kept");
  ok(!("store-c" in ZenTabArchiveStore.getDirty()), "and not uploaded again");
  await clearArchive();
});

add_task(async function test_retention_drops_old_records() {
  await ZenTabArchiveStore.addRecords([
    makeRecord("store-old", { archivedAt: Date.now() - 91 * 24 * HOUR }),
    makeRecord("store-new"),
  ]);
  ok(!ZenTabArchiveStore.getRecord("store-old"), "a 91-day-old record is gone");
  ok(ZenTabArchiveStore.getRecord("store-new"), "a new one is kept");
  ok(
    !("store-old" in ZenTabArchiveStore.getDirty()),
    "and Sync no longer waits for the old one"
  );
  await clearArchive();
});

add_task(async function test_paused_time_does_not_count() {
  const now = Date.now();
  ZenTabArchiveStore.addPause(now - 10 * HOUR, now - 2 * HOUR);
  is(
    ZenTabArchiveStore.runningTimeSince(now - 12 * HOUR, now),
    4 * HOUR,
    "eight hours asleep do not count toward twelve idle"
  );
  is(
    ZenTabArchiveStore.runningTimeSince(now + HOUR, now),
    0,
    "a clock set back never makes a tab older"
  );
  ZenTabArchiveStore.clearPausesForTests();
});

add_task(async function test_a_change_during_upload_stays_dirty() {
  await ZenTabArchiveStore.addRecords([makeRecord("store-race")]);
  const sent = ZenTabArchiveStore.getDirty();
  // The user restores the tab while its record is being uploaded.
  await new Promise(resolve => setTimeout(resolve, 5));
  await ZenTabArchiveStore.removeRecords(["store-race"]);
  ZenTabArchiveStore.markUploaded(["store-race"], sent);
  ok(
    "store-race" in ZenTabArchiveStore.getDirty(),
    "the tombstone still waits to be uploaded"
  );
});

add_task(async function test_clearing_history_clears_the_archive() {
  await ZenTabArchiveStore.addRecords([makeRecord("store-history")]);
  await PlacesUtils.history.clear();
  await TestUtils.waitForCondition(
    () => !ZenTabArchiveStore.getRecord("store-history"),
    "Clear History empties the archive"
  );
});

add_task(async function test_records_survive_a_reload_from_disk() {
  await ZenTabArchiveStore.addRecords([makeRecord("store-disk")]);
  const path = PathUtils.join(PathUtils.profileDir, "zen-archive.jsonlz4");
  const data = await IOUtils.readJSON(path, { decompress: true });
  ok(data.records["store-disk"], "the record is on disk once added");
  ok(
    !data.records["store-disk"].cookies,
    "the file holds no cookies or page data"
  );
  await clearArchive();
});
