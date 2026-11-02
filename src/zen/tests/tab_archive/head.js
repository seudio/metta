/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { gZenTabArchive } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenTabArchive.sys.mjs"
);
const { ZenTabArchiveStore } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenTabArchiveStore.sys.mjs"
);

ChromeUtils.defineESModuleGetters(this, {
  PlacesTestUtils: "resource://testing-common/PlacesTestUtils.sys.mjs",
});

const HOUR = 60 * 60 * 1000;
const UNLOADED_AT_KEY = "zen-archive-unloaded-at";
const ARCHIVE_ID_KEY = "zen-archive-id";
const TEST_ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com"
);

/**
 * Opens a background tab and makes it look idle for `hoursIdle` hours.
 *
 * @param {string} url
 * @param {number} [hoursIdle]
 * @returns {Promise<MozTabbrowserTab>}
 */
async function openIdleTab(url, hoursIdle = 13) {
  const tab = BrowserTestUtils.addTab(gBrowser, url);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url);
  gZenTabArchive.setLastActivityForTests(tab, Date.now() - hoursIdle * HOUR);
  return tab;
}

/** @param {string} url @returns {object?} The newest record for that page */
function recordFor(url) {
  return ZenTabArchiveStore.getRecords().find(record => record.url === url);
}

async function clearArchive() {
  await ZenTabArchiveStore.init();
  await ZenTabArchiveStore.removeRecords(
    ZenTabArchiveStore.getRecords().map(record => record.id),
    { fromSync: true }
  );
}

/** Closes every tab but the selected one, so passes only see a test's tabs. */
function closeOtherTabs() {
  for (const tab of [...gBrowser.tabs]) {
    if (!tab.selected && !tab.pinned && !tab.hasAttribute("zen-essential")) {
      BrowserTestUtils.removeTab(tab);
    }
  }
}

add_setup(async function () {
  gZenTabArchive.setTimerEnabledForTests(false);
  await clearArchive();
  ZenTabArchiveStore.clearPausesForTests();
  registerCleanupFunction(async () => {
    closeOtherTabs();
    await clearArchive();
    ZenTabArchiveStore.clearPausesForTests();
    gZenTabArchive.setTimerEnabledForTests(true);
  });
});
