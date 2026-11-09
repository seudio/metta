/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import {
  archiveLog,
  ZenTabArchiveStore,
} from "resource:///modules/zen/ZenTabArchiveStore.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  ContextualIdentityService:
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SessionStore:
    "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  TabStateFlusher:
    "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "thresholdHours",
  "zen.tabs.auto-archive.threshold-hours",
  12
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "checkMinutes",
  "zen.tabs.auto-archive.check-interval-minutes",
  15
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "startupDelaySeconds",
  "zen.tabs.auto-archive.startup-delay-seconds",
  120
);

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/** The archive record a closed tab belongs to, kept in its session data. */
export const ARCHIVE_ID_KEY = "zen-archive-id";
/** When Auto Archive unloaded the tab, kept in its session data. */
const UNLOADED_AT_KEY = "zen-archive-unloaded-at";

const LAST_ALIVE_PREF = "zen.tabs.auto-archive.last-alive";
const WRITE_FAILED_PREF = "zen.tabs.auto-archive.write-failed";
const MAX_WRITE_FAILURES = 3;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;

/** Pages that hold nothing worth reopening. */
const BLANK_URLS = new Set(["about:blank", "about:newtab", "about:home"]);

/**
 * Closes tabs nobody has used for a while, after saving what is needed to
 * reopen them, and reopens them from the archive in the space and container
 * they came from.
 *
 * A tab is first unloaded once it has been idle past the threshold, and only
 * archived after one more full period with no activity. Idle time counts only
 * while the browser runs.
 */
class nsZenTabArchive {
  #started = false;
  #timer = null;
  #running = null;
  #writeFailures = 0;
  #sleptAt = 0;
  #lastPassAt = 0;
  /** Background activity the tab's own `lastAccessed` does not record. */
  #activity = new WeakMap();

  /**
   * Auto invoked for every window on delayed startup.
   *
   * @param {Window} window - The browser window that just started up
   */
  onDelayedBrowserStartup(window) {
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
      return;
    }
    this.#watchWindow(window);
    for (const tab of this.#allTabs(window)) {
      // A tab still carrying an archive id was reopened after a crash in the
      // middle of a pass, so its record is a duplicate.
      this.#onRevived(tab);
    }
    if (!this.#started) {
      this.#started = true;
      this.#start().catch(console.error);
    }
  }

  async #start() {
    await ZenTabArchiveStore.init();
    const lastAlive = Services.prefs.getIntPref(LAST_ALIVE_PREF, 0) * 1000;
    const now = Date.now();
    if (lastAlive && now - lastAlive > 2 * lazy.checkMinutes * MS_PER_MINUTE) {
      // The browser was not running, so that time does not age tabs.
      ZenTabArchiveStore.addPause(lastAlive, now);
    }
    this.#touchLastAlive();
    Services.obs.addObserver(this, "sleep_notification");
    Services.obs.addObserver(this, "wake_notification");
    Services.obs.addObserver(this, "quit-application-granted");
    this.#schedule(lazy.startupDelaySeconds * 1000);
  }

  observe(subject, topic) {
    switch (topic) {
      case "sleep_notification":
        this.#sleptAt = Date.now();
        break;
      case "wake_notification":
        if (this.#sleptAt) {
          ZenTabArchiveStore.addPause(this.#sleptAt, Date.now());
          this.#sleptAt = 0;
          // The sleep is accounted for, so the next pass must not take the
          // long gap since the last one for a sleep nobody announced.
          this.#touchLastAlive();
        }
        break;
      case "quit-application-granted":
        this.#touchLastAlive();
        lazy.clearTimeout(this.#timer);
        break;
    }
  }

  #touchLastAlive() {
    this.#lastPassAt = Date.now();
    Services.prefs.setIntPref(
      LAST_ALIVE_PREF,
      Math.floor(this.#lastPassAt / 1000)
    );
  }

  /**
   * A timer due during sleep can fire before the wake notification, or with
   * no notification at all. Either way that time must not age tabs.
   */
  #notePausesBeforePass() {
    const now = Date.now();
    if (this.#sleptAt) {
      ZenTabArchiveStore.addPause(this.#sleptAt, now);
      this.#sleptAt = 0;
    } else if (
      this.#lastPassAt &&
      now - this.#lastPassAt > 2 * lazy.checkMinutes * MS_PER_MINUTE
    ) {
      ZenTabArchiveStore.addPause(this.#lastPassAt, now);
    }
  }

  #schedule(delay) {
    lazy.clearTimeout(this.#timer);
    this.#timer = lazy.setTimeout(() => {
      this.#runPass()
        .catch(console.error)
        .finally(() => this.#schedule(lazy.checkMinutes * MS_PER_MINUTE));
    }, delay);
  }

  /** @param {Window} window */
  #watchWindow(window) {
    // Zen keeps tabs in each space's own container, outside the tab strip,
    // so tab events are heard on the window.
    const onTab = handler => event => {
      if (window.gBrowser.isTab(event.target)) {
        handler(event.target);
      }
    };
    window.addEventListener(
      "TabSelect",
      onTab(tab => this.#onActivity(tab, { selected: true }))
    );
    for (const type of ["TabMove", "TabGrouped", "TabUngrouped"]) {
      window.addEventListener(
        type,
        onTab(tab => this.#onActivity(tab))
      );
    }
    window.addEventListener(
      "SSTabRestoring",
      onTab(tab => this.#onRevived(tab))
    );
    const progressListener = {
      onLocationChange: (browser, webProgress, request, location, flags) => {
        if (
          !webProgress.isTopLevel ||
          flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
        ) {
          return;
        }
        const tab = window.gBrowser.getTabForBrowser(browser);
        if (tab) {
          this.#onActivity(tab);
        }
      },
    };
    window.gBrowser.addTabsProgressListener(progressListener);
    window.addEventListener(
      "unload",
      () => window.gBrowser.removeTabsProgressListener(progressListener),
      { once: true }
    );
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @param {object} [options]
   * @param {boolean} [options.selected] - The user selected the tab
   */
  #onActivity(tab, { selected = false } = {}) {
    // An unloaded tab cannot navigate, so only selecting it counts.
    if (tab.hasAttribute("pending") && !selected) {
      return;
    }
    this.#activity.set(tab, Date.now());
    this.#clearValue(tab, UNLOADED_AT_KEY);
  }

  /**
   * A tab that comes back with an archive id was reopened with Undo Close
   * Tab, or after a crash, so it leaves the archive.
   *
   * @param {MozTabbrowserTab} tab
   */
  #onRevived(tab) {
    const id = this.#getValue(tab, ARCHIVE_ID_KEY);
    if (!id) {
      return;
    }
    archiveLog("Tab came back, dropping its record", id);
    this.#clearValue(tab, ARCHIVE_ID_KEY);
    this.#clearValue(tab, UNLOADED_AT_KEY);
    this.#activity.set(tab, Date.now());
    ZenTabArchiveStore.removeRecords([id]).catch(console.error);
  }

  #getValue(tab, key) {
    try {
      return lazy.SessionStore.getCustomTabValue(tab, key) || "";
    } catch {
      return "";
    }
  }

  #setValue(tab, key, value) {
    try {
      lazy.SessionStore.setCustomTabValue(tab, key, String(value));
    } catch (e) {
      console.error("ZenTabArchive: could not set a tab value:", e);
    }
  }

  #clearValue(tab, key) {
    if (this.#getValue(tab, key)) {
      lazy.SessionStore.deleteCustomTabValue(tab, key);
    }
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @param {Window} window
   * @returns {string?} Why the tab must stay open, if it must
   */
  #protection(tab, window) {
    if (tab.closing || !tab.isConnected) {
      return "closing";
    }
    if (tab.selected || tab.multiselected) {
      return "selected";
    }
    if (tab.splitView && tab.group?.tabs?.some(other => other.selected)) {
      return "split-view";
    }
    if (tab.pinned) {
      return "pinned";
    }
    if (tab.hasAttribute("zen-essential")) {
      return "essential";
    }
    if (tab.hasAttribute("zen-empty-tab")) {
      return "empty";
    }
    if (tab.hasAttribute("glance-id")) {
      return "glance";
    }
    if (tab.hasAttribute("zen-live-folder-item-id")) {
      return "live-folder";
    }
    if (
      tab.soundPlaying ||
      tab.hasAttribute("sharing") ||
      tab.hasAttribute("pictureinpicture")
    ) {
      return "media";
    }
    const space = window.gZenWorkspaces?.getWorkspaceFromId(
      tab.getAttribute("zen-workspace-id")
    );
    if (space?.autoArchive === false) {
      return "space-disabled";
    }
    return null;
  }

  /**
   * Whether a loaded tab's page would ask before leaving. Having a
   * beforeunload listener is not enough: many pages keep one all the time
   * and only object when something is unsaved. So the page is asked, as
   * closing a tab asks it, without showing its prompt.
   *
   * @param {MozTabbrowserTab} tab
   * @returns {Promise<boolean>}
   */
  async #isUnsaved(tab) {
    if (tab.hasAttribute("pending")) {
      return false;
    }
    const browser = tab.linkedBrowser;
    try {
      if (
        !browser?.isRemoteBrowser ||
        !browser.frameLoader ||
        !browser.hasBeforeUnload
      ) {
        return false;
      }
      const { permitUnload } = await browser.asyncPermitUnload("dontUnload");
      return !permitUnload;
    } catch {
      // Unknown means unsaved: never risk losing what the user typed.
      return true;
    }
  }

  /**
   * @param {object[][]} candidates - Mirrors of each tab
   * @returns {Promise<object[][]>} The candidates with nothing unsaved
   */
  async #withoutUnsaved(candidates) {
    const unsaved = await Promise.all(
      candidates.map(async mirrors =>
        (
          await Promise.all(mirrors.map(({ tab }) => this.#isUnsaved(tab)))
        ).some(Boolean)
      )
    );
    return candidates.filter((mirrors, i) => {
      if (unsaved[i]) {
        mirrors.forEach(({ tab }) => this.#clearValue(tab, UNLOADED_AT_KEY));
      }
      return !unsaved[i];
    });
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @returns {number} When the tab was last used
   */
  #lastActivity(tab) {
    const last = Math.max(tab.lastAccessed || 0, this.#activity.get(tab) || 0);
    if (last) {
      return last;
    }
    // A tab restored in the background has never been selected, so it ages
    // from the moment it is first seen.
    const now = Date.now();
    this.#activity.set(tab, now);
    return now;
  }

  /**
   * @param {Window} window
   * @returns {MozTabbrowserTab[]} Every tab of the window, in every space.
   *   `gBrowser.tabs` holds only the tabs of the space on screen.
   */
  #allTabs(window) {
    return window.gZenWorkspaces?.workspaceEnabled
      ? window.gZenWorkspaces.allStoredTabs
      : window.gBrowser.tabs;
  }

  /**
   * Every tab of every normal window, with the windows that mirror it. Zen
   * keeps the same tab in each synced window under one id, and closing it
   * in one closes it in all of them.
   *
   * @returns {Map<string, {tab: MozTabbrowserTab, window: Window}[]>}
   */
  #collectTabs() {
    const byId = new Map();
    for (const window of lazy.BrowserWindowTracker.orderedWindows) {
      if (
        window.closed ||
        !window.gBrowser ||
        lazy.PrivateBrowsingUtils.isWindowPrivate(window)
      ) {
        continue;
      }
      for (const tab of this.#allTabs(window)) {
        const mirrors = byId.get(tab.id);
        if (mirrors) {
          mirrors.push({ tab, window });
        } else {
          byId.set(tab.id, [{ tab, window }]);
        }
      }
    }
    return byId;
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.force] - Archive now, skipping the waits
   * @returns {Promise<number>} How many tabs were archived
   */
  #runPass(options = {}) {
    if (this.#running) {
      return this.#running;
    }
    this.#running = this.#pass(options).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #pass({ force = false } = {}) {
    await ZenTabArchiveStore.init();
    this.#notePausesBeforePass();
    this.#touchLastAlive();
    const threshold = lazy.thresholdHours * MS_PER_HOUR;
    if (!force) {
      if (threshold <= 0) {
        return 0;
      }
      if (Services.prefs.getBoolPref(WRITE_FAILED_PREF, false)) {
        // Paused until "Archive inactive tabs now" gets a write through.
        return 0;
      }
    }
    const now = Date.now();
    let toArchive = [];
    let toUnload = [];
    for (const mirrors of this.#collectTabs().values()) {
      if (mirrors.some(({ tab, window }) => this.#protection(tab, window))) {
        mirrors.forEach(({ tab }) => this.#clearValue(tab, UNLOADED_AT_KEY));
        continue;
      }
      if (force) {
        toArchive.push(mirrors);
        continue;
      }
      const since = Math.max(
        ...mirrors.map(({ tab }) => this.#lastActivity(tab))
      );
      if (
        !Number.isFinite(since) ||
        ZenTabArchiveStore.runningTimeSince(since, now) < threshold
      ) {
        mirrors.forEach(({ tab }) => this.#clearValue(tab, UNLOADED_AT_KEY));
        continue;
      }
      const unloadedAt = Number(
        this.#getValue(mirrors[0].tab, UNLOADED_AT_KEY)
      );
      if (!unloadedAt) {
        toUnload.push(mirrors);
        continue;
      }
      if (ZenTabArchiveStore.runningTimeSince(unloadedAt, now) >= threshold) {
        toArchive.push(mirrors);
      }
    }
    // Only tabs about to go are asked about unsaved changes, since asking
    // runs the page's beforeunload listeners.
    toUnload = await this.#withoutUnsaved(toUnload);
    toArchive = await this.#withoutUnsaved(toArchive);
    const unloadByWindow = new Map();
    for (const mirrors of toUnload) {
      for (const { tab, window } of mirrors) {
        this.#setValue(tab, UNLOADED_AT_KEY, now);
        if (!tab.hasAttribute("pending")) {
          const tabs = unloadByWindow.get(window) ?? [];
          tabs.push(tab);
          unloadByWindow.set(window, tabs);
        }
      }
    }
    for (const [window, tabs] of unloadByWindow) {
      archiveLog(`Unloading ${tabs.length} idle tabs`);
      try {
        await window.gBrowser.explicitUnloadTabs(tabs);
      } catch (e) {
        console.error("ZenTabArchive: could not unload tabs:", e);
      }
    }
    if (!toArchive.length) {
      return 0;
    }
    return this.#archive(toArchive, force ? "manual" : "auto");
  }

  /**
   * Saves the records first and only closes tabs once they are on disk. A
   * tab that cannot be recorded, or that refuses to close, stays open.
   *
   * @param {object[][]} candidates - Mirrors of each tab to archive
   * @param {string} reason - "auto" or "manual"
   * @returns {Promise<number>} How many tabs were archived
   */
  async #archive(candidates, reason) {
    const entries = [];
    for (const mirrors of candidates) {
      const record = this.#recordFor(mirrors[0].tab, reason);
      if (record) {
        entries.push({ record, mirrors });
      }
    }
    if (!entries.length) {
      return 0;
    }
    // A tab unloaded before its page had a title can still find one in
    // History.
    await Promise.all(
      entries.map(async ({ record }) => {
        if (record.title) {
          return;
        }
        try {
          const page = await lazy.PlacesUtils.history.fetch(record.url);
          if (page?.title) {
            record.title = page.title;
          }
        } catch (e) {
          console.error("ZenTabArchive: could not look up a title:", e);
        }
      })
    );
    // Every mirror carries the id before the record is written, so a tab
    // that comes back after a crash, or with Undo Close Tab, takes its
    // record out of the archive.
    for (const { record, mirrors } of entries) {
      mirrors.forEach(({ tab }) =>
        this.#setValue(tab, ARCHIVE_ID_KEY, record.id)
      );
    }
    try {
      await ZenTabArchiveStore.addRecords(entries.map(({ record }) => record));
    } catch (e) {
      for (const { mirrors } of entries) {
        mirrors.forEach(({ tab }) => this.#clearValue(tab, ARCHIVE_ID_KEY));
      }
      this.#writeFailures++;
      console.error("ZenTabArchive: could not save the archive:", e);
      if (this.#writeFailures >= MAX_WRITE_FAILURES) {
        Services.prefs.setBoolPref(WRITE_FAILED_PREF, true);
      }
      return 0;
    }
    this.#writeFailures = 0;
    if (Services.prefs.getBoolPref(WRITE_FAILED_PREF, false)) {
      Services.prefs.clearUserPref(WRITE_FAILED_PREF);
    }

    // A loaded tab's saved state can lag behind its page. Closing it with a
    // stale state would leave a blank entry in Recently Closed, which Undo
    // Close Tab could not bring back.
    await Promise.all(
      entries.flatMap(({ mirrors }) =>
        mirrors
          .filter(({ tab }) => !tab.hasAttribute("pending") && tab.isConnected)
          .map(({ tab }) =>
            lazy.TabStateFlusher.flush(tab.linkedBrowser).catch(console.error)
          )
      )
    );

    let archived = 0;
    const dropped = [];
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      if (i) {
        await new Promise(resolve => lazy.setTimeout(resolve, BATCH_DELAY_MS));
      }
      for (const { record, mirrors } of entries.slice(i, i + BATCH_SIZE)) {
        if (this.#close(record, mirrors)) {
          archived++;
        } else {
          dropped.push(record.id);
        }
      }
    }
    if (dropped.length) {
      await ZenTabArchiveStore.removeRecords(dropped, { discard: true });
    }
    archiveLog(`Archived ${archived} tabs, kept ${dropped.length} open`);
    return archived;
  }

  /**
   * @param {object} record
   * @param {object[]} mirrors
   * @returns {boolean} Whether the tab closed
   */
  #close(record, mirrors) {
    const live = mirrors.filter(({ tab }) => tab.isConnected && !tab.closing);
    if (
      !live.length ||
      live.some(({ tab, window }) => this.#protection(tab, window))
    ) {
      live.forEach(({ tab }) => this.#clearValue(tab, ARCHIVE_ID_KEY));
      return false;
    }
    const { tab, window } = live[0];
    window.gBrowser.removeTab(tab, {
      animate: false,
      closeWindowWithLastTab: false,
    });
    if (tab.closing || !tab.isConnected) {
      return true;
    }
    // The page asked to stay open, and it gets to.
    live.forEach(({ tab: mirror }) => this.#clearValue(mirror, ARCHIVE_ID_KEY));
    return false;
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @param {string} reason
   * @returns {object?} What is needed to reopen the tab, or null for a tab
   *   with nothing worth reopening
   */
  #recordFor(tab, reason) {
    const page = this.#pageOf(tab);
    if (!page?.url || BLANK_URLS.has(page.url)) {
      return null;
    }
    const { url } = page;
    const userContextId = tab.userContextId || 0;
    const image =
      typeof page.image === "string" && !page.image.startsWith("data:")
        ? page.image
        : undefined;
    return {
      id: Services.uuid.generateUUID().toString().slice(1, -1),
      url,
      title: page.title || undefined,
      image,
      workspaceId: tab.getAttribute("zen-workspace-id") || undefined,
      userContextId,
      containerName: userContextId
        ? lazy.ContextualIdentityService.getUserContextLabel(userContextId)
        : undefined,
      customLabel:
        typeof tab.zenStaticLabel === "string" && tab.zenStaticLabel
          ? tab.zenStaticLabel
          : undefined,
      lastActivity: Number.isFinite(this.#lastActivity(tab))
        ? this.#lastActivity(tab)
        : Date.now(),
      archivedAt: Date.now(),
      reason,
    };
  }

  /**
   * Stops or restarts the regular timer, so tests are not raced by a pass.
   *
   * @param {boolean} enabled
   */
  setTimerEnabledForTests(enabled) {
    lazy.clearTimeout(this.#timer);
    this.#timer = null;
    if (enabled) {
      this.#schedule(lazy.checkMinutes * MS_PER_MINUTE);
    }
  }

  /**
   * Makes a tab look idle since `time`. Used by tests.
   *
   * @param {MozTabbrowserTab} tab
   * @param {number} time
   */
  setLastActivityForTests(tab, time) {
    this.#activity.set(tab, time);
    tab.updateLastAccessed(time);
  }

  /**
   * Runs the regular pass right away rather than on the next timer, with the
   * usual threshold and unload wait. Used by tests.
   *
   * @returns {Promise<number>} How many tabs were archived
   */
  checkNow() {
    return this.#runPass();
  }

  /**
   * A loaded tab is read from its browser, since its saved session state
   * catches up only some time after a page loads. An unloaded tab has only
   * its saved state.
   *
   * @param {MozTabbrowserTab} tab
   * @returns {{url: string, title: string, image: string}?}
   */
  #pageOf(tab) {
    if (!tab.hasAttribute("pending")) {
      const browser = tab.linkedBrowser;
      return {
        url: browser.currentURI?.spec,
        title: browser.contentTitle,
        image: tab.image,
      };
    }
    try {
      const state = JSON.parse(lazy.SessionStore.getTabState(tab));
      const entry = state.entries?.[(state.index || state.entries.length) - 1];
      return { url: entry?.url, title: entry?.title, image: state.image };
    } catch (e) {
      console.error("ZenTabArchive: could not read a tab's state:", e);
      return null;
    }
  }

  /**
   * Archives every tab that is not protected, skipping the threshold and the
   * unload wait.
   *
   * @returns {Promise<number>} How many tabs were archived
   */
  async archiveNow() {
    if (this.#running) {
      await this.#running;
    }
    return this.#runPass({ force: true });
  }

  /**
   * Finds the container a record was in. Containers do not sync, so on
   * another device the same container is found by its name.
   *
   * @param {object} record
   * @returns {{userContextId: number, missing: boolean}}
   */
  #resolveContainer(record) {
    if (!record.userContextId) {
      return { userContextId: 0, missing: false };
    }
    const service = lazy.ContextualIdentityService;
    const label = id => service.getUserContextLabel(id);
    if (
      service.getPublicIdentityFromId(record.userContextId) &&
      (!record.containerName ||
        label(record.userContextId) === record.containerName)
    ) {
      return { userContextId: record.userContextId, missing: false };
    }
    const byName = record.containerName
      ? service
          .getPublicIdentities()
          .find(
            identity => label(identity.userContextId) === record.containerName
          )
      : null;
    if (byName) {
      return { userContextId: byName.userContextId, missing: false };
    }
    return { userContextId: 0, missing: true };
  }

  /**
   * Reopens an archived tab in its space and container, and takes it out of
   * the archive once the tab exists.
   *
   * @param {string} id - The record to restore
   * @param {object} [options]
   * @param {Window} [options.window] - Where to reopen it
   * @param {boolean} [options.inBackground] - Leave the current tab selected
   * @returns {Promise<MozTabbrowserTab?>} The reopened tab
   */
  async restore(id, { window = null, inBackground = false } = {}) {
    // Nothing is awaited before the tab opens, so a caller can keep the
    // library open around it (see ZenLibrary.keepOpenWhile). The archive is
    // already read by the time anything lists a record to restore.
    const record = ZenTabArchiveStore.getRecord(id);
    window ??= lazy.BrowserWindowTracker.getTopWindow({ private: false });
    if (!record || !window) {
      return null;
    }
    const { gBrowser, gZenWorkspaces } = window;
    const spaces = gZenWorkspaces?.workspaceEnabled ? gZenWorkspaces : null;
    const space = spaces?.getWorkspaceFromId(record.workspaceId);
    const spaceId = space?.uuid ?? spaces?.activeWorkspace;
    const spaceGone = !!spaces && !!record.workspaceId && !space;
    const { userContextId, missing } = this.#resolveContainer(record);

    const tab = gBrowser.addTrustedTab(record.url, {
      userContextId,
      inBackground: true,
      skipRoute: true,
    });
    if (!tab) {
      // The record stays, so the user can try again.
      return null;
    }
    if (spaceId && tab.getAttribute("zen-workspace-id") !== spaceId) {
      tab.setAttribute("zen-workspace-id", spaceId);
      spaces.moveTabToWorkspace(tab, spaceId);
    }
    if (record.customLabel) {
      tab.zenStaticLabel = record.customLabel;
      gBrowser._setTabLabel(tab, record.customLabel, {
        _zenChangeLabelFlag: true,
      });
    }
    await ZenTabArchiveStore.removeRecords([id]);
    this.#forgetClosedEntries(id);

    if (!inBackground) {
      if (spaceId && spaceId !== spaces.activeWorkspace) {
        await spaces.changeWorkspaceWithID(spaceId);
      }
      gBrowser.selectedTab = tab;
    }
    if (spaceGone || missing) {
      window.gZenUIManager?.showToast(
        spaceGone
          ? "zen-tab-archive-restored-other-space"
          : "zen-tab-archive-restored-default-container",
        { l10nArgs: { space: spaces?.getWorkspaceFromId(spaceId)?.name ?? "" } }
      );
    }
    return tab;
  }

  /**
   * Takes the tab's entries out of Recently Closed, so Undo Close Tab does
   * not open it a second time.
   *
   * @param {string} id
   */
  #forgetClosedEntries(id) {
    for (const window of lazy.BrowserWindowTracker.orderedWindows) {
      let closed;
      try {
        closed = lazy.SessionStore.getClosedTabDataForWindow(window);
      } catch {
        continue;
      }
      for (const entry of closed) {
        if (entry.state?.extData?.[ARCHIVE_ID_KEY] === id) {
          try {
            lazy.SessionStore.forgetClosedTabById(entry.closedId);
          } catch (e) {
            // The tab is already open again; a stale entry only costs a
            // duplicate if the user later reopens it by hand.
            console.error("ZenTabArchive: could not forget a closed tab:", e);
          }
        }
      }
    }
  }

  /**
   * @param {string[]} ids - Records to delete for good
   * @returns {Promise<void>}
   */
  deleteRecords(ids) {
    return ZenTabArchiveStore.removeRecords(ids);
  }
}

export const gZenTabArchive = new nsZenTabArchive();
