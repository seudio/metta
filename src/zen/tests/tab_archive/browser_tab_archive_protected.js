/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_protected_tabs_are_never_archived() {
  const pinned = await openIdleTab("https://example.com/?pinned");
  gBrowser.pinTab(pinned);

  const essential = await openIdleTab("https://example.com/?essential");
  gZenPinnedTabManager.addToEssentials(essential);

  const unsaved = await openIdleTab(`${TEST_ROOT}file_beforeunload.html`);
  await TestUtils.waitForCondition(
    () => unsaved.linkedBrowser.hasBeforeUnload,
    "the page registered its beforeunload handler"
  );

  const plain = await openIdleTab("https://example.com/?plain");
  const plainClosed = BrowserTestUtils.waitForTabClosing(plain);

  const selected = gBrowser.selectedTab;
  await gZenTabArchive.archiveNow();
  await plainClosed;

  ok(selected.isConnected, "the selected tab stays open");
  ok(pinned.isConnected, "a pinned tab stays open");
  ok(essential.isConnected, "an Essential stays open");
  ok(unsaved.isConnected, "a tab with unsaved changes stays open");
  ok(!unsaved.hasAttribute("pending"), "and keeps its page loaded");
  ok(recordFor("https://example.com/?plain"), "only the plain tab is archived");
  is(ZenTabArchiveStore.getRecords().length, 1, "and nothing else");

  gZenPinnedTabManager.removeEssentials(essential);
  for (const tab of [pinned, essential, unsaved]) {
    BrowserTestUtils.removeTab(tab, { skipPermitUnload: true });
  }
  await clearArchive();
});

add_task(async function test_a_beforeunload_listener_alone_does_not_protect() {
  const url = `${TEST_ROOT}file_beforeunload_saved.html`;
  const saved = await openIdleTab(url);
  await TestUtils.waitForCondition(
    () => saved.linkedBrowser.hasBeforeUnload,
    "the page registered its beforeunload handler"
  );
  const closed = BrowserTestUtils.waitForTabClosing(saved);
  await gZenTabArchive.archiveNow();
  await closed;
  ok(recordFor(url), "a page with nothing unsaved is archived");
  await clearArchive();
});

add_task(async function test_a_page_with_a_listener_is_unloaded_when_idle() {
  const url = `${TEST_ROOT}file_beforeunload_saved.html?idle`;
  const saved = await openIdleTab(url);
  await TestUtils.waitForCondition(
    () => saved.linkedBrowser.hasBeforeUnload,
    "the page registered its beforeunload handler"
  );
  await gZenTabArchive.checkNow();
  await TestUtils.waitForCondition(
    () => saved.hasAttribute("pending"),
    "the idle tab is unloaded"
  );
  ok(
    SessionStore.getCustomTabValue(saved, UNLOADED_AT_KEY),
    "and will be archived one period later"
  );
  BrowserTestUtils.removeTab(saved);
});

add_task(async function test_an_idle_unsaved_page_stays_loaded() {
  const unsaved = await openIdleTab(`${TEST_ROOT}file_beforeunload.html?idle`);
  await TestUtils.waitForCondition(
    () => unsaved.linkedBrowser.hasBeforeUnload,
    "the page registered its beforeunload handler"
  );
  await gZenTabArchive.checkNow();
  ok(
    !unsaved.hasAttribute("pending"),
    "a page with unsaved changes stays loaded"
  );
  ok(
    !SessionStore.getCustomTabValue(unsaved, UNLOADED_AT_KEY),
    "and is not on its way to the archive"
  );
  BrowserTestUtils.removeTab(unsaved, { skipPermitUnload: true });
});

add_task(async function test_a_space_can_turn_archiving_off() {
  const space = gZenWorkspaces.getActiveWorkspaceFromCache();
  space.autoArchive = false;
  await gZenWorkspaces.saveWorkspace(space);

  const tab = await openIdleTab("https://example.com/?space-off");
  tab.setAttribute("zen-workspace-id", space.uuid);
  await gZenTabArchive.archiveNow();
  ok(tab.isConnected, "tabs in a space with archiving off stay open");

  delete space.autoArchive;
  await gZenWorkspaces.saveWorkspace(space);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_failed_write_keeps_the_tab_open() {
  const tab = await openIdleTab("https://example.com/?write-fails");
  const original = ZenTabArchiveStore.addRecords;
  ZenTabArchiveStore.addRecords = () =>
    Promise.reject(new Error("disk is full"));
  try {
    is(await gZenTabArchive.archiveNow(), 0, "nothing is archived");
  } finally {
    ZenTabArchiveStore.addRecords = original;
  }
  ok(tab.isConnected, "a tab whose record was not saved stays open");
  ok(
    !SessionStore.getCustomTabValue(tab, ARCHIVE_ID_KEY),
    "and is not marked as archived"
  );
  BrowserTestUtils.removeTab(tab);
});
