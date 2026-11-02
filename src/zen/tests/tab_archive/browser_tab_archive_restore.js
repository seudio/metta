/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ContextualIdentityService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs"
);

/**
 * @param {MozTabbrowserTab} tab
 * @returns {Promise<object>} The tab's record once it is archived
 */
async function archive(tab, url) {
  const closed = BrowserTestUtils.waitForTabClosing(tab);
  await gZenTabArchive.archiveNow();
  await closed;
  const record = recordFor(url);
  ok(record, `${url} is archived`);
  return record;
}

add_task(async function test_restore_into_the_original_space_and_container() {
  const identity = ContextualIdentityService.create("Archive Work");
  const startSpace = gZenWorkspaces.activeWorkspace;
  const space = await gZenWorkspaces.createAndSaveWorkspace(
    "Archive Space",
    undefined,
    false,
    identity.userContextId
  );

  // Opened while its space is active, the way a user would.
  const url = "https://example.com/?restore-space";
  const tab = BrowserTestUtils.addTab(gBrowser, url, {
    userContextId: identity.userContextId,
  });
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url);
  is(
    tab.getAttribute("zen-workspace-id"),
    space.uuid,
    "the tab is in the space"
  );
  await gZenWorkspaces.changeWorkspaceWithID(startSpace);
  const record = await archive(tab, url);
  is(record.userContextId, identity.userContextId, "the container is kept");
  is(record.containerName, "Archive Work", "with its name");

  const restored = await gZenTabArchive.restore(record.id, {
    window,
    inBackground: true,
  });
  ok(restored, "the tab is reopened");
  is(
    restored.getAttribute("zen-workspace-id"),
    space.uuid,
    "in the space it came from"
  );
  is(
    restored.userContextId,
    identity.userContextId,
    "in the container it came from"
  );
  ok(!recordFor(url), "the record leaves the archive");
  ok(
    !SessionStore.getClosedTabDataForWindow(window).some(
      entry => entry.state?.extData?.[ARCHIVE_ID_KEY] === record.id
    ),
    "and Undo Close Tab will not reopen it a second time"
  );

  BrowserTestUtils.removeTab(restored);
  await gZenWorkspaces.changeWorkspaceWithID(startSpace);
  await gZenWorkspaces.removeWorkspace(space.uuid);
  ContextualIdentityService.remove(identity.userContextId);
});

add_task(async function test_restore_falls_back_when_the_space_is_gone() {
  const startSpace = gZenWorkspaces.activeWorkspace;
  const space =
    await gZenWorkspaces.createAndSaveWorkspace("Short-lived Space");
  await gZenWorkspaces.changeWorkspaceWithID(startSpace);
  const url = "https://example.com/?space-gone";
  const tab = await openIdleTab(url);
  tab.setAttribute("zen-workspace-id", space.uuid);
  gZenWorkspaces.moveTabToWorkspace(tab, space.uuid);
  const record = await archive(tab, url);
  await gZenWorkspaces.removeWorkspace(space.uuid);

  const restored = await gZenTabArchive.restore(record.id, {
    window,
    inBackground: true,
  });
  is(
    restored.getAttribute("zen-workspace-id"),
    gZenWorkspaces.activeWorkspace,
    "a tab whose space was deleted opens in the current space"
  );
  BrowserTestUtils.removeTab(restored);
});

add_task(async function test_container_is_found_by_name() {
  const identity = ContextualIdentityService.create("Synced Container");
  const url = "https://example.com/?container-by-name";
  const id = "test-container-by-name";
  await ZenTabArchiveStore.addRecords([
    {
      id,
      url,
      title: "From another device",
      // Another device numbers its containers differently.
      userContextId: identity.userContextId + 1000,
      containerName: "Synced Container",
      archivedAt: Date.now(),
      lastActivity: Date.now(),
      reason: "auto",
    },
  ]);
  const restored = await gZenTabArchive.restore(id, {
    window,
    inBackground: true,
  });
  is(
    restored.userContextId,
    identity.userContextId,
    "the container with the same name is used"
  );
  BrowserTestUtils.removeTab(restored);
  ContextualIdentityService.remove(identity.userContextId);
});
