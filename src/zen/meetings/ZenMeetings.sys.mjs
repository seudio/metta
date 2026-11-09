// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZenUIComponent } from "resource:///modules/zen/ui/ZenUIComponent.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import {
  clearInterval,
  setInterval,
} from "resource://gre/modules/Timer.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  eventsBetween: "resource:///modules/zen/ZenCalendarFeed.sys.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "LEAD_MINUTES",
  "zen.meetings.lead-minutes",
  5
);

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "REFRESH_MINUTES",
  "zen.meetings.refresh-minutes",
  10
);

const URLS_PREF = "zen.meetings.calendar-urls";
const CHANGED_TOPIC = "zen-meetings-changed";
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MAX_FEED_BYTES = 10 * 1024 * 1024;

// How far around now to keep meetings, so the card is right between
// refreshes and while offline.
const KEEP_BEFORE = 6 * MS_PER_HOUR;
const KEEP_AFTER = 36 * MS_PER_HOUR;

// How often each window checks whether its card should change.
const TICK_MS = 15 * 1000;

/**
 * @param {string} value - The pref: calendar addresses, one per line
 * @returns {string[]} The addresses, with webcal links turned into https
 */
function parseCalendarUrls(value) {
  return value
    .split(/[\s,]+/)
    .map(url => url.trim().replace(/^webcals?:\/\//i, "https://"))
    .filter(url => /^https?:\/\//i.test(url));
}

/**
 * Fetches the calendars in `zen.meetings.calendar-urls` and keeps the
 * meetings of the next day and a half, so each window can show the one
 * about to start.
 */
class nsZenMeetings {
  /** @type {Map<string, {events: object[], error: ?string, fetchedAt: number}>} */
  #feeds = new Map();
  #dismissed = new Set();
  #timer = null;
  #refreshing = null;
  #initialized = false;

  /** Overridable for tests. */
  now() {
    return Date.now();
  }

  init() {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    Services.prefs.addObserver(URLS_PREF, this);
    Services.prefs.addObserver("zen.meetings.refresh-minutes", this);
    Services.obs.addObserver(this, "wake_notification");
    Services.obs.addObserver(this, "network:offline-status-changed");
    Services.obs.addObserver(this, "quit-application-granted");
    this.#schedule();
    this.refresh().catch(console.error);
  }

  #uninit() {
    Services.prefs.removeObserver(URLS_PREF, this);
    Services.prefs.removeObserver("zen.meetings.refresh-minutes", this);
    Services.obs.removeObserver(this, "wake_notification");
    Services.obs.removeObserver(this, "network:offline-status-changed");
    Services.obs.removeObserver(this, "quit-application-granted");
    clearInterval(this.#timer);
    this.#timer = null;
  }

  observe(subject, topic, data) {
    switch (topic) {
      case "nsPref:changed":
        if (data === URLS_PREF) {
          this.#feeds.clear();
          this.#notify();
        }
        this.#schedule();
        this.refresh().catch(console.error);
        break;
      case "wake_notification":
        this.refresh().catch(console.error);
        break;
      case "network:offline-status-changed":
        if (data === "online") {
          this.refresh().catch(console.error);
        }
        break;
      case "quit-application-granted":
        this.#uninit();
        break;
    }
  }

  get calendarUrls() {
    return parseCalendarUrls(Services.prefs.getStringPref(URLS_PREF, ""));
  }

  #schedule() {
    clearInterval(this.#timer);
    this.#timer = null;
    if (this.calendarUrls.length) {
      this.#timer = setInterval(
        () => this.refresh().catch(console.error),
        Math.max(1, lazy.REFRESH_MINUTES) * MS_PER_MINUTE
      );
    }
  }

  /** Fetches every calendar again. */
  refresh() {
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #refresh() {
    const urls = this.calendarUrls;
    for (const url of this.#feeds.keys()) {
      if (!urls.includes(url)) {
        this.#feeds.delete(url);
      }
    }
    await Promise.all(urls.map(url => this.#fetchFeed(url)));
    this.#notify();
  }

  async #fetchFeed(url) {
    const now = this.now();
    try {
      const response = await fetch(url, {
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const length = Number(response.headers.get("content-length"));
      if (length > MAX_FEED_BYTES) {
        throw new Error("Calendar too large");
      }
      const text = await response.text();
      if (!text.includes("BEGIN:VCALENDAR")) {
        throw new Error("Not a calendar");
      }
      this.#feeds.set(url, {
        events: lazy.eventsBetween(text, now - KEEP_BEFORE, now + KEEP_AFTER),
        error: null,
        fetchedAt: now,
      });
    } catch (error) {
      // Keep what was fetched before, so a failed refresh doesn't hide a
      // meeting that is about to start.
      const previous = this.#feeds.get(url);
      this.#feeds.set(url, {
        events: previous?.events ?? [],
        error: String(error.message ?? error),
        fetchedAt: previous?.fetchedAt ?? 0,
      });
    }
  }

  #notify() {
    Services.obs.notifyObservers(null, CHANGED_TOPIC);
  }

  #key(meeting) {
    return `${meeting.uid} ${meeting.start}`;
  }

  /**
   * The meeting to show: the latest one that has a video call link, starts
   * within the lead time and has not ended or been dismissed.
   *
   * @returns {object?}
   */
  get currentMeeting() {
    const now = this.now();
    const lead = lazy.LEAD_MINUTES * MS_PER_MINUTE;
    let current = null;
    const seen = new Set();
    for (const { events } of this.#feeds.values()) {
      for (const meeting of events) {
        const key = this.#key(meeting);
        if (
          !meeting.joinUrl ||
          seen.has(key) ||
          this.#dismissed.has(key) ||
          meeting.start - lead > now ||
          meeting.end <= now
        ) {
          continue;
        }
        // The same meeting can be in several calendars.
        seen.add(key);
        if (!current || meeting.start > current.start) {
          current = meeting;
        }
      }
    }
    return current;
  }

  /**
   * Hides a meeting's card in every window.
   *
   * @param {object} meeting
   */
  dismiss(meeting) {
    this.#dismissed.add(this.#key(meeting));
    this.#notify();
  }

  /**
   * For the settings page.
   *
   * @returns {object} { calendars, failed, meetingsToday, errors }
   */
  get status() {
    const now = this.now();
    const endOfDay = new Date(now).setHours(24, 0, 0, 0);
    let failed = 0;
    let meetingsToday = 0;
    for (const { events, error } of this.#feeds.values()) {
      if (error) {
        failed++;
      }
      meetingsToday += events.filter(
        meeting =>
          meeting.joinUrl && meeting.end > now && meeting.start < endOfDay
      ).length;
    }
    const errors = [...this.#feeds.values()]
      .map(({ error }) => error)
      .filter(Boolean);
    return {
      calendars: this.calendarUrls.length,
      failed,
      meetingsToday,
      errors,
    };
  }

  resetForTesting() {
    this.#feeds.clear();
    this.#dismissed.clear();
    delete this.now;
  }
}

export const gZenMeetings = new nsZenMeetings();

/**
 * The card in each window's sidebar that offers to join the current
 * meeting.
 */
export class ZenMeetingCard extends ZenUIComponent {
  #element = null;
  #meeting = null;
  #ticker = null;

  init() {
    gZenMeetings.init();
    this.window.gZenMeetingCard = this;
    this.#element = this.#build();
    this.document
      .getElementById("zen-media-controls-toolbar")
      .after(this.#element);
    Services.obs.addObserver(this, CHANGED_TOPIC);
    this.#ticker = this.window.setInterval(() => this.update(), TICK_MS);
    this.update();
  }

  uninit() {
    Services.obs.removeObserver(this, CHANGED_TOPIC);
    this.window.clearInterval(this.#ticker);
  }

  observe() {
    this.update();
  }

  get element() {
    return this.#element;
  }

  #build() {
    const fragment = this.window.MozXULElement.parseXULToFragment(`
      <vbox id="zen-meeting-card" hidden="true">
        <hbox class="zen-meeting-header" align="center">
          <image class="zen-meeting-icon"/>
          <label class="zen-meeting-title" crop="end" flex="1"/>
          <toolbarbutton class="zen-meeting-close toolbarbutton-1"
                         data-l10n-id="zen-meeting-dismiss"/>
        </hbox>
        <hbox class="zen-meeting-footer" align="center">
          <hbox class="zen-meeting-subtitle" align="center" flex="1">
            <label class="zen-meeting-when" crop="end"/>
            <label class="zen-meeting-separator" value="·"/>
            <label class="zen-meeting-provider" crop="end"/>
          </hbox>
          <button class="zen-meeting-join" data-l10n-id="zen-meeting-join"/>
        </hbox>
      </vbox>
    `);
    const element = fragment.firstElementChild;
    element
      .querySelector(".zen-meeting-join")
      .addEventListener("command", () => this.join());
    element
      .querySelector(".zen-meeting-close")
      .addEventListener("command", () => {
        if (this.#meeting) {
          gZenMeetings.dismiss(this.#meeting);
        }
      });
    return element;
  }

  /** Opens the current meeting's link and hides its card. */
  join() {
    const meeting = this.#meeting;
    if (!meeting) {
      return;
    }
    this.window.openTrustedLinkIn(meeting.joinUrl, "tab");
    gZenMeetings.dismiss(meeting);
  }

  update() {
    const meeting = gZenMeetings.currentMeeting;
    this.#meeting = meeting;
    this.#element.hidden = !meeting;
    if (!meeting) {
      return;
    }
    const element = this.#element;
    const title = element.querySelector(".zen-meeting-title");
    if (meeting.title) {
      title.removeAttribute("data-l10n-id");
      title.value = meeting.title;
    } else {
      this.document.l10n.setAttributes(title, "zen-meeting-untitled");
    }
    title.setAttribute("tooltiptext", meeting.title);

    const minutes = Math.round(
      (meeting.start - gZenMeetings.now()) / MS_PER_MINUTE
    );
    const when = element.querySelector(".zen-meeting-when");
    if (minutes > 0) {
      this.document.l10n.setAttributes(when, "zen-meeting-starts-in", {
        minutes,
      });
    } else if (minutes === 0) {
      this.document.l10n.setAttributes(when, "zen-meeting-starting-now");
    } else {
      this.document.l10n.setAttributes(when, "zen-meeting-started-ago", {
        minutes: -minutes,
      });
    }
    element.querySelector(".zen-meeting-provider").value = meeting.provider;
    element.toggleAttribute("started", minutes <= 0);
  }
}
