/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  gZenMeetings: "resource:///modules/zen/ZenMeetings.sys.mjs",
  gZenSecurityWatch: "resource:///modules/zen/ZenSecurityWatch.sys.mjs",
  gZenTabArchive: "resource:///modules/zen/ZenTabArchive.sys.mjs",
});

const kArchiveWriteFailedPref = "zen.tabs.auto-archive.write-failed";
const kCalendarsPref = "zen.meetings.calendar-urls";

/** The pane for what Metta adds to Zen. */
export class ZenSettingsMetta {
  constructor(settings) {
    this.settings = settings;
    this.#initArchive();
    this.#initMeetings();
    this.#initSecurity();
  }

  #initArchive() {
    this.settings.watchPrefs([kArchiveWriteFailedPref], () => {
      document.getElementById("metta-settings-archive-write-failed").hidden =
        !Services.prefs.getBoolPref(kArchiveWriteFailedPref, false);
    });

    const button = document.getElementById("metta-settings-archive-now-button");
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const count = await lazy.gZenTabArchive.archiveNow();
        const result = document.getElementById(
          "metta-settings-archive-now-result"
        );
        document.l10n.setAttributes(result, "metta-settings-archive-now-done", {
          count,
        });
        result.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  }

  #initMeetings() {
    const calendars = document.getElementById(
      "metta-settings-meetings-calendars"
    );
    this.settings.watchPrefs([kCalendarsPref], () => {
      const value = Services.prefs.getStringPref(kCalendarsPref, "");
      // Leave what is being typed alone.
      if (calendars.value.trim() != value) {
        calendars.value = value;
      }
    });
    calendars.addEventListener("change", () => {
      Services.prefs.setStringPref(kCalendarsPref, calendars.value.trim());
    });

    const update = () => this.#updateMeetings();
    this.settings.watchTopics(["zen-meetings-changed"], update);
    lazy.gZenMeetings.init();
    update();
  }

  #updateMeetings() {
    const status = document.getElementById("metta-settings-meetings-status");
    const { calendars, failed, meetingsToday } = lazy.gZenMeetings.status;
    status.hidden = !calendars;
    if (failed) {
      document.l10n.setAttributes(
        status,
        "metta-settings-meetings-status-failed",
        { failed }
      );
    } else {
      document.l10n.setAttributes(status, "metta-settings-meetings-status", {
        count: meetingsToday,
      });
    }
  }

  #initSecurity() {
    const update = () => this.#updateSecurity();
    this.settings.watchTopics(["zen-security-watch-changed"], update);
    document
      .getElementById("metta-settings-security-check-now")
      .addEventListener("click", () => {
        lazy.gZenSecurityWatch.check().catch(console.error);
      });
    document
      .getElementById("metta-settings-security-update-button")
      .addEventListener("click", () => {
        lazy.gZenSecurityWatch.openUpdatePage();
      });
    lazy.gZenSecurityWatch.init();
    update();
  }

  #updateSecurity() {
    const status = document.getElementById("metta-settings-security-status");
    const text = document.getElementById("metta-settings-security-status-text");
    const { current, latest, action, missing, checkedAt, error, release } =
      lazy.gZenSecurityWatch.status;
    document.getElementById("metta-settings-security-update").hidden = !release;
    if (release) {
      document.l10n.setAttributes(
        document.getElementById("metta-settings-security-update-text"),
        `metta-settings-security-update-${release.status}`,
        { metta: release.version, firefox: release.firefox }
      );
    }
    if (!checkedAt) {
      status.removeAttribute("data-state");
      document.l10n.setAttributes(
        text,
        error
          ? "metta-settings-security-status-failed"
          : "metta-settings-security-status-unchecked"
      );
    } else if (!missing) {
      status.setAttribute("data-state", "success");
      document.l10n.setAttributes(
        text,
        "metta-settings-security-status-current",
        { current, time: checkedAt }
      );
    } else {
      status.setAttribute("data-state", "warning");
      document.l10n.setAttributes(
        text,
        action === "block"
          ? "metta-settings-security-status-exploited"
          : "metta-settings-security-status-behind",
        { current, latest, time: checkedAt }
      );
    }
  }
}
