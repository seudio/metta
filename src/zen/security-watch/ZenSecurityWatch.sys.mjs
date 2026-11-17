// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZenUIComponent } from "resource:///modules/zen/ui/ZenUIComponent.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from "resource://gre/modules/Timer.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  assess: "resource:///modules/zen/ZenSecurityFeed.sys.mjs",
  compareVersions: "resource:///modules/zen/ZenSecurityFeed.sys.mjs",
  parseAdvisory: "resource:///modules/zen/ZenSecurityFeed.sys.mjs",
  parseKnownExploited: "resource:///modules/zen/ZenSecurityFeed.sys.mjs",
  parseKnownVulnerabilities: "resource:///modules/zen/ZenSecurityFeed.sys.mjs",
  releasesAfter: "resource:///modules/zen/ZenSecurityFeed.sys.mjs",
});

ChromeUtils.defineLazyGetter(
  lazy,
  "l10n",
  () => new Localization(["browser/zen-general.ftl"], true)
);

const PREF = "zen.security-watch.";

XPCOMUtils.defineLazyPreferenceGetter(lazy, "ENABLED", `${PREF}enabled`, true);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "BLOCK_EXPLOITED",
  `${PREF}block-exploited`,
  true
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "CHECK_HOURS",
  `${PREF}check-hours`,
  6
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "GRACE_DAYS",
  `${PREF}grace-days`,
  3
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "VULNERABILITIES_URL",
  `${PREF}vulnerabilities-url`,
  "https://www.mozilla.org/en-US/security/known-vulnerabilities/firefox/"
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "ADVISORY_URL",
  `${PREF}advisory-url`,
  "https://www.mozilla.org/en-US/security/advisories/%ID%/"
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "EXPLOITED_URL",
  `${PREF}exploited-url`,
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
);

const STATE_PREF = `${PREF}state`;
const ACKNOWLEDGED_PREF = `${PREF}acknowledged`;
const VERSION_OVERRIDE_PREF = `${PREF}version-override`;
const CHANGED_TOPIC = "zen-security-watch-changed";

const MS_PER_HOUR = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 10 * 1000;
// A check this recent is not repeated when the browser starts.
const FRESH_MS = MS_PER_HOUR;
const SNOOZE_MS = 24 * MS_PER_HOUR;
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
// More releases behind than this and the newest ones say enough.
const MAX_ADVISORIES = 12;

const SERIOUS = ["high", "critical"];

/**
 * Watches for security fixes that Firefox has released and this build does
 * not have yet.
 *
 * A build that is missing a serious fix asks once whether to carry on. A
 * build that is missing a fix for a bug already used in attacks stops
 * loading web pages until that is approved, once per session.
 */
class nsZenSecurityWatch {
  #initialized = false;
  #state = null;
  #timer = null;
  #startupTimer = null;
  #checking = null;
  #observingRequests = false;
  #prompting = false;
  #snoozedUntil = 0;
  /** The exploited bugs approved for this session. */
  #approved = new Set();
  /** The address each tab was going to when its load was stopped. */
  #held = new WeakMap();
  #lastError = null;

  /** Overridable for tests. */
  now() {
    return Date.now();
  }

  /**
   * Asks whether to carry on without the fixes. Overridable for tests.
   *
   * @param {Window} window
   * @param {string} title
   * @param {string} body
   * @param {string[]} buttons - Two labels
   * @returns {number} The index of the button chosen
   */
  confirm(window, title, body, buttons) {
    const { prompt } = Services;
    return prompt.confirmEx(
      window,
      title,
      body,
      prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING +
        prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_IS_STRING,
      buttons[0],
      buttons[1],
      null,
      null,
      {}
    );
  }

  init() {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    this.#state = this.#readState();
    Services.prefs.addObserver(PREF, this);
    Services.obs.addObserver(this, "wake_notification");
    Services.obs.addObserver(this, "network:offline-status-changed");
    Services.obs.addObserver(this, "quit-application-granted");
    this.#apply();
    this.#schedule();
    this.#startupTimer = setTimeout(() => {
      this.#startupTimer = null;
      this.#checkIfStale();
    }, STARTUP_DELAY_MS);
  }

  #uninit() {
    Services.prefs.removeObserver(PREF, this);
    Services.obs.removeObserver(this, "wake_notification");
    Services.obs.removeObserver(this, "network:offline-status-changed");
    Services.obs.removeObserver(this, "quit-application-granted");
    this.#observeRequests(false);
    clearInterval(this.#timer);
    clearTimeout(this.#startupTimer);
    this.#timer = null;
  }

  observe(subject, topic, data) {
    switch (topic) {
      case "http-on-modify-request":
        this.#onRequest(subject);
        break;
      case "nsPref:changed":
        if (data === STATE_PREF || data === ACKNOWLEDGED_PREF) {
          break;
        }
        if (data === VERSION_OVERRIDE_PREF || data.endsWith("-url")) {
          this.#state = null;
        }
        this.#schedule();
        this.#apply();
        if (data !== `${PREF}block-exploited`) {
          this.check().catch(console.error);
        }
        break;
      case "wake_notification":
        this.#checkIfStale();
        break;
      case "network:offline-status-changed":
        if (data === "online") {
          this.#checkIfStale();
        }
        break;
      case "quit-application-granted":
        this.#uninit();
        break;
    }
  }

  /** The Firefox version this build is based on. */
  get currentVersion() {
    return (
      Services.prefs.getStringPref(VERSION_OVERRIDE_PREF, "") ||
      Services.appinfo.platformVersion
    );
  }

  #readState() {
    try {
      const state = JSON.parse(Services.prefs.getStringPref(STATE_PREF, ""));
      // What an older build was missing says nothing about this one.
      if (state?.version === this.currentVersion) {
        return state;
      }
    } catch {}
    return null;
  }

  #schedule() {
    clearInterval(this.#timer);
    this.#timer = null;
    if (lazy.ENABLED) {
      this.#timer = setInterval(
        () => this.check().catch(console.error),
        Math.max(1, lazy.CHECK_HOURS) * MS_PER_HOUR
      );
    }
  }

  #checkIfStale() {
    if (this.now() - (this.#state?.checkedAt ?? 0) > FRESH_MS) {
      this.check().catch(console.error);
    }
  }

  /**
   * Looks for fixes this build is missing.
   *
   * @returns {Promise<void>}
   */
  check() {
    if (!lazy.ENABLED) {
      return Promise.resolve();
    }
    this.#checking ??= this.#check().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  async #fetchText(url) {
    const response = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    }
    if (Number(response.headers.get("content-length")) > MAX_PAGE_BYTES) {
      throw new Error(`Too large a reply from ${new URL(url).host}`);
    }
    return response.text();
  }

  async #check() {
    const version = this.currentVersion;
    try {
      const releases = lazy.releasesAfter(
        lazy.parseKnownVulnerabilities(
          await this.#fetchText(lazy.VULNERABILITIES_URL)
        ),
        version
      );
      const listed = releases
        .flatMap(release =>
          release.advisories.map(advisory => ({
            ...advisory,
            version: release.version,
          }))
        )
        .slice(-MAX_ADVISORIES);

      const advisories = await Promise.all(
        listed.map(async advisory => {
          const page = lazy.parseAdvisory(
            await this.#fetchText(
              lazy.ADVISORY_URL.replace("%ID%", advisory.id)
            )
          );
          return {
            ...advisory,
            ...page,
            // The list's rating stands if the page's could not be read.
            level: page.level === "none" ? advisory.level : page.level,
          };
        })
      );

      // The catalog is large, and only matters to a build that is behind.
      let knownExploited = new Set();
      let partial = null;
      if (advisories.length) {
        try {
          knownExploited = lazy.parseKnownExploited(
            await this.#fetchText(lazy.EXPLOITED_URL)
          );
        } catch (error) {
          partial = String(error.message ?? error);
        }
      }

      const result = lazy.assess({
        advisories,
        knownExploited,
        now: this.now(),
        graceDays: lazy.GRACE_DAYS,
      });
      if (version !== this.currentVersion) {
        return;
      }
      this.#lastError = partial;
      this.#state = {
        version,
        checkedAt: this.now(),
        action: result.action,
        level: result.level,
        latest: releases.at(-1)?.version ?? version,
        exploited: result.exploited,
        advisories: result.advisories.map(advisory => ({
          id: advisory.id,
          version: advisory.version,
          title: advisory.title,
          level: advisory.level,
          announced: advisory.announced,
          serious: advisory.cves.filter(cve => SERIOUS.includes(cve.level))
            .length,
          exploited: advisory.cves
            .filter(cve => cve.exploited)
            .map(({ id, title }) => ({ id, title })),
        })),
      };
      Services.prefs.setStringPref(STATE_PREF, JSON.stringify(this.#state));
    } catch (error) {
      // Keep what the last check found: failing to reach a feed is no
      // reason to lift a block, or to raise one.
      this.#lastError = String(error.message ?? error);
    }
    this.#apply();
  }

  /** The exploited bugs this build is missing and nobody has approved. */
  get #unapproved() {
    return (this.#state?.exploited ?? []).filter(id => !this.#approved.has(id));
  }

  /** Whether web pages are being held back. */
  get blocking() {
    return (
      lazy.ENABLED &&
      lazy.BLOCK_EXPLOITED &&
      this.#state?.action === "block" &&
      !!this.#unapproved.length
    );
  }

  /** What the last check found, or null before the first one. */
  get state() {
    return this.#state;
  }

  /**
   * For the settings page.
   *
   * @returns {object} { enabled, current, latest, action, level, missing,
   *   checkedAt, error }
   */
  get status() {
    return {
      enabled: lazy.ENABLED,
      current: this.currentVersion,
      latest: this.#state?.latest ?? null,
      action: this.#state?.action ?? null,
      level: this.#state?.level ?? "none",
      missing: this.#state?.advisories.length ?? 0,
      checkedAt: this.#state?.checkedAt ?? 0,
      error: this.#lastError,
    };
  }

  /**
   * @param {XULBrowserElement} browser
   * @returns {boolean} Whether a page this tab was loading was stopped
   */
  isHeld(browser) {
    return this.#held.has(browser);
  }

  /**
   * @param {XULBrowserElement} browser - A tab that has gone somewhere else
   */
  release(browser) {
    this.#held.delete(browser);
  }

  /** Lets web pages load for the rest of the session. */
  approve() {
    for (const id of this.#state?.exploited ?? []) {
      this.#approved.add(id);
    }
    this.#apply();
    const held = ChromeUtils.nondeterministicGetWeakMapKeys(this.#held);
    for (const browser of held) {
      const url = this.#held.get(browser);
      this.#held.delete(browser);
      if (!browser.isConnected) {
        continue;
      }
      try {
        browser.fixupAndLoadURIString(url, {
          triggeringPrincipal:
            Services.scriptSecurityManager.createNullPrincipal({}),
        });
      } catch (error) {
        console.error(error);
      }
    }
  }

  #apply() {
    this.#observeRequests(this.blocking);
    Services.obs.notifyObservers(null, CHANGED_TOPIC);
    this.maybePrompt();
  }

  #observeRequests(observe) {
    if (observe === this.#observingRequests) {
      return;
    }
    this.#observingRequests = observe;
    if (observe) {
      Services.obs.addObserver(this, "http-on-modify-request");
    } else {
      Services.obs.removeObserver(this, "http-on-modify-request");
    }
  }

  /**
   * Stops a request made by a tab. Requests from the browser itself and
   * from extensions' own pages go through, so the check can still run.
   *
   * @param {nsISupports} subject
   */
  #onRequest(subject) {
    if (!this.blocking) {
      return;
    }
    try {
      const channel = subject.QueryInterface(Ci.nsIHttpChannel);
      const { loadInfo } = channel;
      const context =
        loadInfo.targetBrowsingContext ?? loadInfo.browsingContext;
      const browser = context?.top?.embedderElement;
      const window = context?.topChromeWindow;
      if (!browser || !window?.gBrowser?.getTabForBrowser(browser)) {
        return;
      }
      const isPage =
        loadInfo.externalContentPolicyType ===
        Ci.nsIContentPolicy.TYPE_DOCUMENT;
      channel.cancel(Cr.NS_ERROR_ABORT);
      if (isPage) {
        this.#held.set(browser, channel.URI.spec);
        Services.obs.notifyObservers(null, CHANGED_TOPIC);
      }
    } catch (error) {
      console.error(error);
    }
  }

  get #acknowledged() {
    return new Set(
      Services.prefs.getStringPref(ACKNOWLEDGED_PREF, "").split(",")
    );
  }

  /** The serious advisories nobody has been asked about yet. */
  get #unacknowledged() {
    const state = this.#state;
    // A block that is turned off, or already approved, still deserves the
    // question.
    if (!state || !["prompt", "block"].includes(state.action)) {
      return [];
    }
    const acknowledged = this.#acknowledged;
    return state.advisories.filter(
      advisory =>
        (SERIOUS.includes(advisory.level) || advisory.exploited.length) &&
        !acknowledged.has(advisory.id)
    );
  }

  /** Asks, in the frontmost window, about fixes not asked about before. */
  maybePrompt() {
    if (
      this.#prompting ||
      !lazy.ENABLED ||
      this.blocking ||
      this.now() < this.#snoozedUntil ||
      !this.#unacknowledged.length
    ) {
      return;
    }
    this.#prompting = true;
    Services.tm.dispatchToMainThread(() => {
      try {
        this.#prompt();
      } catch (error) {
        console.error(error);
      } finally {
        this.#prompting = false;
      }
    });
  }

  #prompt() {
    const advisories = this.#unacknowledged;
    const window = lazy.BrowserWindowTracker.getTopWindow();
    if (!advisories.length || this.blocking || !window) {
      return;
    }
    const { version, latest } = this.#state;
    const format = (id, args) => lazy.l10n.formatValueSync(id, args);
    const list = advisories
      .map(advisory =>
        format("zen-security-prompt-item", {
          version: advisory.version,
          level: advisory.level,
          count: advisory.serious,
        })
      )
      .join("\n");
    const choice = this.confirm(
      window,
      format("zen-security-prompt-title"),
      [
        format("zen-security-prompt-intro", { current: version, latest }),
        list,
        format("zen-security-prompt-advice"),
      ].join("\n\n"),
      [
        format("zen-security-prompt-continue"),
        format("zen-security-prompt-later"),
      ]
    );
    if (choice === 0) {
      const acknowledged = this.#acknowledged;
      // Forget the ones this build no longer lacks.
      const current = new Set(
        this.#state.advisories.map(advisory => advisory.id)
      );
      Services.prefs.setStringPref(
        ACKNOWLEDGED_PREF,
        [...advisories.map(advisory => advisory.id), ...acknowledged]
          .filter(id => current.has(id))
          .join(",")
      );
    } else {
      this.#snoozedUntil = this.now() + SNOOZE_MS;
    }
  }

  resetForTesting() {
    this.#state = null;
    this.#approved.clear();
    this.#held = new WeakMap();
    this.#snoozedUntil = 0;
    this.#lastError = null;
    Services.prefs.clearUserPref(STATE_PREF);
    Services.prefs.clearUserPref(ACKNOWLEDGED_PREF);
    delete this.now;
    delete this.confirm;
    this.#apply();
  }
}

export const gZenSecurityWatch = new nsZenSecurityWatch();

/**
 * The screen that covers each window's web pages while this build is
 * missing a fix for a bug that is being used in attacks.
 */
export class ZenSecurityBlock extends ZenUIComponent {
  #element = null;

  init() {
    gZenSecurityWatch.init();
    this.window.gZenSecurityBlock = this;
    this.#element = this.#build();
    this.document.getElementById("tabbrowser-tabbox").append(this.#element);
    Services.obs.addObserver(this, CHANGED_TOPIC);
    this.window.gBrowser.tabContainer.addEventListener("TabSelect", this);
    this.listenBrowserProgress();
    this.update();
    gZenSecurityWatch.maybePrompt();
  }

  uninit() {
    Services.obs.removeObserver(this, CHANGED_TOPIC);
  }

  observe() {
    this.update();
  }

  handleEvent(event) {
    if (event.type === "TabSelect") {
      this.update();
    } else {
      super.handleEvent(event);
    }
  }

  onLocationChange(webProgress, request, location) {
    if (!webProgress.isTopLevel) {
      return;
    }
    // A tab that has moved on is no longer waiting for the page that was
    // stopped. Switching tabs reports a location too, without a request.
    if (request && !location.schemeIs("http") && !location.schemeIs("https")) {
      gZenSecurityWatch.release(this.window.gBrowser.selectedBrowser);
    }
    this.update();
  }

  get element() {
    return this.#element;
  }

  #build() {
    const fragment = this.window.MozXULElement.parseXULToFragment(`
      <vbox id="zen-security-block" hidden="true" align="center" pack="center">
        <vbox class="zen-security-block-box">
          <image class="zen-security-block-icon"/>
          <html:h1 data-l10n-id="zen-security-block-title"/>
          <html:p class="zen-security-block-summary"/>
          <html:ul class="zen-security-block-list"/>
          <html:p data-l10n-id="zen-security-block-advice"/>
          <hbox pack="end">
            <button class="zen-security-block-continue"
                    data-l10n-id="zen-security-block-continue"/>
          </hbox>
        </vbox>
      </vbox>
    `);
    const element = fragment.firstElementChild;
    element
      .querySelector(".zen-security-block-continue")
      .addEventListener("command", () => gZenSecurityWatch.approve());
    return element;
  }

  update() {
    const { gBrowser } = this.window;
    const browser = gBrowser.selectedBrowser;
    const uri = browser?.currentURI;
    const show =
      gZenSecurityWatch.blocking &&
      !!browser &&
      (gZenSecurityWatch.isHeld(browser) ||
        uri?.schemeIs("http") ||
        uri?.schemeIs("https"));
    this.#element.hidden = !show;
    // Keep the keyboard out of the page underneath as well.
    gBrowser.tabpanels.toggleAttribute("inert", show);
    if (!show) {
      return;
    }
    const { version, latest, advisories } = gZenSecurityWatch.state;
    this.document.l10n.setAttributes(
      this.#element.querySelector(".zen-security-block-summary"),
      "zen-security-block-summary",
      { current: version, latest }
    );
    const list = this.#element.querySelector(".zen-security-block-list");
    const items = [];
    for (const advisory of advisories) {
      for (const { id, title } of advisory.exploited) {
        items.push(`${id}: ${title} (Firefox ${advisory.version})`);
      }
    }
    list.replaceChildren(
      ...items.map(text => {
        const item = this.document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "li"
        );
        item.textContent = text;
        return item;
      })
    );
    list.hidden = !items.length;
  }
}
