/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_idle_tab_is_unloaded_then_archived() {
  const url = "https://example.com/?lifecycle";
  const tab = await openIdleTab(url);

  await gZenTabArchive.checkNow();
  ok(tab.isConnected, "the tab stays open after the first pass");
  await TestUtils.waitForCondition(
    () => tab.hasAttribute("pending"),
    "the tab is unloaded once it is idle past the threshold"
  );
  ok(
    SessionStore.getCustomTabValue(tab, UNLOADED_AT_KEY),
    "the unload time is remembered"
  );

  await gZenTabArchive.checkNow();
  ok(tab.isConnected, "the tab waits one more period before it is archived");

  SessionStore.setCustomTabValue(
    tab,
    UNLOADED_AT_KEY,
    String(Date.now() - 13 * HOUR)
  );
  const closed = BrowserTestUtils.waitForTabClosing(tab);
  is(await gZenTabArchive.checkNow(), 1, "one tab is archived");
  await closed;

  const record = recordFor(url);
  ok(record, "the archive has a record for the tab");
  is(record.reason, "auto", "the record says it was archived automatically");
  is(
    record.workspaceId,
    gZenWorkspaces.activeWorkspace,
    "the record keeps the tab's space"
  );
  ok(!("cookies" in record) && !("entries" in record), "no page data is kept");
  await clearArchive();
});

add_task(async function test_selecting_an_unloaded_tab_restarts_its_wait() {
  const original = gBrowser.selectedTab;
  const tab = await openIdleTab("https://example.com/?selected");
  await gZenTabArchive.checkNow();
  await TestUtils.waitForCondition(() => tab.hasAttribute("pending"));

  await BrowserTestUtils.switchTab(gBrowser, tab);
  ok(
    !SessionStore.getCustomTabValue(tab, UNLOADED_AT_KEY),
    "selecting the tab forgets that it was unloaded"
  );
  await BrowserTestUtils.switchTab(gBrowser, original);
  await gZenTabArchive.checkNow();
  ok(tab.isConnected, "a tab used just now is not archived");
  ok(!tab.hasAttribute("pending"), "and it is not unloaded again");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_never_turns_archiving_off() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.auto-archive.threshold-hours", 0]],
  });
  const tab = await openIdleTab("https://example.com/?never", 24 * 60);
  await gZenTabArchive.checkNow();
  ok(!tab.hasAttribute("pending"), "nothing is unloaded when set to Never");
  ok(tab.isConnected, "nothing is archived when set to Never");
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_undo_close_takes_a_tab_out_of_the_archive() {
  const url = "https://example.com/?undo";
  const tab = await openIdleTab(url);
  const closed = BrowserTestUtils.waitForTabClosing(tab);
  await gZenTabArchive.archiveNow();
  await closed;
  ok(recordFor(url), "the tab is archived");

  const original = gBrowser.selectedTab;
  const reopened = SessionStore.undoCloseTab(window, 0);
  await TestUtils.waitForCondition(
    () => !recordFor(url),
    "reopening the tab with Undo Close Tab removes its record"
  );
  await BrowserTestUtils.switchTab(gBrowser, original);
  BrowserTestUtils.removeTab(reopened);
});

add_task(async function test_an_untitled_page_takes_its_title_from_history() {
  const url = `${TEST_ROOT}file_untitled.html`;
  const tab = await openIdleTab(url);
  await PlacesTestUtils.addVisits({ uri: url, title: "Title from History" });
  const closed = BrowserTestUtils.waitForTabClosing(tab);
  await gZenTabArchive.archiveNow();
  await closed;
  is(recordFor(url)?.title, "Title from History", "the record has a title");
  await PlacesUtils.history.clear();
  await clearArchive();
});
