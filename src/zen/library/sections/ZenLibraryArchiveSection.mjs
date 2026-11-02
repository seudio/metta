/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, repeat } from "chrome://global/content/vendor/lit.all.mjs";
import {
  MS_PER_DAY,
  ZenLibrarySearchSection,
  whenFilterGroup,
} from "moz-src:///zen/library/sections/ZenLibrarySearchSection.mjs";

let lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PlacesUIUtils: "moz-src:///browser/components/places/PlacesUIUtils.sys.mjs",
  ZenTabArchiveStore: "resource:///modules/zen/ZenTabArchiveStore.sys.mjs",
  gZenTabArchive: "resource:///modules/zen/ZenTabArchive.sys.mjs",
});

ChromeUtils.defineLazyGetter(
  lazy,
  "relativeDayFormat",
  () => new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
);

ChromeUtils.defineLazyGetter(
  lazy,
  "dateFormat",
  () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
);

ChromeUtils.defineLazyGetter(
  lazy,
  "timeFormat",
  () => new Intl.DateTimeFormat(undefined, { timeStyle: "short" })
);

const ARCHIVE_CHANGED_TOPIC = "zen-tab-archive-changed";
const REASONS = ["auto", "manual"];

/** @param {number} time @returns {number} The start of that day */
function startOfDay(time) {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** @returns {Promise<boolean>} Whether the user agreed to empty the archive */
async function confirmDeleteAll() {
  const [title, message, accept] = await document.l10n.formatValues([
    "library-archive-delete-all-prompt-title",
    "library-archive-delete-all-prompt-message",
    "library-archive-delete-all-prompt-accept",
  ]);
  const flags =
    Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
    Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL;
  return (
    Services.prompt.confirmEx(
      window,
      title ?? "",
      message ?? "",
      flags,
      accept,
      null,
      null,
      null,
      {}
    ) === 0
  );
}

/**
 * The tabs Auto Archive closed, newest first, ready to be reopened in the
 * space and container they came from.
 */
export class ZenLibraryArchiveSection extends ZenLibrarySearchSection {
  static id = "archive";
  static label = "library-archive-section-title";

  static render(library) {
    return html`
      <zen-library-archive-section
        class="zen-library-section"
        data-section="archive"
        .library=${library}
      ></zen-library-archive-section>
    `;
  }

  /** @returns {object[]} What a right click on the archive tab offers */
  static get tabMenu() {
    return [
      {
        l10nId: "library-archive-archive-now",
        command: () => lazy.gZenTabArchive.archiveNow().catch(console.error),
      },
      {
        l10nId: "library-archive-delete-all",
        separatorBefore: true,
        command: async () => {
          if (await confirmDeleteAll()) {
            lazy.ZenTabArchiveStore.clear().catch(console.error);
          }
        },
      },
    ];
  }

  static properties = {
    records: { state: true },
  };

  #menu = null;
  #menuRecord = null;
  #menuRow = null;

  constructor() {
    super();
    this.records = null;
  }

  connectedCallback() {
    super.connectedCallback();
    Services.obs.addObserver(this.#changedObserver, ARCHIVE_CHANGED_TOPIC);
    lazy.ZenTabArchiveStore.init()
      .then(() => this.#fetch())
      .catch(console.error);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    Services.obs.removeObserver(this.#changedObserver, ARCHIVE_CHANGED_TOPIC);
    this.#menu?.hidePopup();
    this.#menu?.remove();
    this.#menu = null;
    this.#menuRecord = null;
    this.#menuRow = null;
  }

  #changedObserver = {
    observe: () => this.#fetch(),
  };

  get searchPlaceholderL10nId() {
    return "library-archive-search-placeholder";
  }

  get filterTitleL10nId() {
    return "library-archive-filter-title";
  }

  get filterGroups() {
    return [
      whenFilterGroup("library-archive-filter-when"),
      {
        id: "reason",
        titleL10nId: "library-archive-filter-reason",
        exclusive: true,
        options: [
          { id: "auto", l10nId: "library-archive-reason-auto" },
          { id: "manual", l10nId: "library-archive-reason-manual" },
        ],
      },
    ];
  }

  onSearchChanged() {
    this.#fetch();
  }

  onFiltersChanged() {
    this.#fetch();
  }

  /** Groups the matching records by the day they were archived. */
  #fetch() {
    const days = this.activeWhenDays;
    const cutoff = days ? Date.now() - days * MS_PER_DAY : 0;
    const reason = REASONS.find(id => this.isFilterActive("reason", id));
    const query = this.searchQuery.toLowerCase();
    const byDay = new Map();
    for (const record of lazy.ZenTabArchiveStore.getRecords()) {
      if (record.archivedAt < cutoff || (reason && record.reason !== reason)) {
        continue;
      }
      const title = record.customLabel || record.title || record.url;
      if (query && !`${title} ${record.url}`.toLowerCase().includes(query)) {
        continue;
      }
      const day = startOfDay(record.archivedAt);
      const sameDay = byDay.get(day);
      if (sameDay) {
        sameDay.push(record);
      } else {
        byDay.set(day, [record]);
      }
    }
    this.records = byDay;
  }

  /**
   * @param {object} record
   * @param {Event?} event - What opened it; Accel or a middle click opens it
   *   in the background
   */
  #restore(record, event) {
    const inBackground =
      !!event && (event.getModifierState("Accel") || event.button === 1);
    const restore = () =>
      lazy.gZenTabArchive
        .restore(record.id, { window, inBackground })
        .catch(console.error);
    if (!inBackground) {
      restore();
      this.library.constructor.toggle();
      return;
    }
    // The tab opens before the first await, so the library stays open.
    this.library.keepOpenWhile(restore);
    gZenUIManager.showToast("library-history-opened-in-background");
  }

  #delete(record) {
    lazy.gZenTabArchive.deleteRecords([record.id]).catch(console.error);
  }

  #buildMenu() {
    const menu = window.MozXULElement.parseXULToFragment(`
      <menupopup class="zen-library-archive-menu">
        <menuitem data-action="restore" data-l10n-id="library-archive-menu-restore"/>
        <menuitem data-action="copy" data-l10n-id="library-archive-menu-copy-link"/>
        <menuseparator/>
        <menuitem data-action="delete" data-l10n-id="library-archive-menu-delete"/>
      </menupopup>
    `).firstElementChild;
    menu.addEventListener("command", event => {
      const record = this.#menuRecord;
      if (!record) {
        return;
      }
      switch (event.target.dataset.action) {
        case "restore":
          this.#restore(record, null);
          break;
        case "copy":
          Cc["@mozilla.org/widget/clipboardhelper;1"]
            .getService(Ci.nsIClipboardHelper)
            .copyString(record.url);
          break;
        case "delete":
          this.#delete(record);
          break;
      }
    });
    menu.addEventListener("popuphidden", () => {
      menu.hidden = true;
      this.#menuRow?.removeAttribute("menu-open");
      this.#menuRow = null;
      this.#menuRecord = null;
    });
    menu.hidden = true;
    document.getElementById("mainPopupSet").appendChild(menu);
    return menu;
  }

  #openMenu(record, row, event) {
    this.#menu ??= this.#buildMenu();
    this.#menu.hidden = false;
    this.#menuRow?.removeAttribute("menu-open");
    this.#menuRow = row;
    this.#menuRecord = record;
    row.setAttribute("menu-open", "true");
    this.#menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
  }

  #formatDay(day) {
    const daysAgo = Math.round((startOfDay(Date.now()) - day) / MS_PER_DAY);
    const formatted =
      daysAgo <= 6
        ? lazy.relativeDayFormat.format(-daysAgo, "day")
        : lazy.dateFormat.format(day);
    return formatted.charAt(0).toLocaleUpperCase() + formatted.slice(1);
  }

  #formatUrl(url) {
    return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  }

  #onDragStart(event, record) {
    const { dataTransfer } = event;
    const title = record.title || record.url;
    dataTransfer.setData("text/x-moz-url", `${record.url}\n${title}`);
    dataTransfer.setData("text/uri-list", record.url);
    dataTransfer.setData("text/plain", record.url);
    dataTransfer.effectAllowed = "copyLink";
    dataTransfer.addElement(event.currentTarget);
  }

  #renderRecord(record) {
    const space = gZenWorkspaces.getWorkspaceFromId(record.workspaceId);
    return html`
      <div
        class="zen-library-row"
        draggable="true"
        @click=${event => this.#restore(record, event)}
        @auxclick=${event => {
          if (event.button === 1) {
            event.preventDefault();
            this.#restore(record, event);
          }
        }}
        @dragstart=${event => this.#onDragStart(event, record)}
        @contextmenu=${event => {
          event.preventDefault();
          this.#openMenu(record, event.currentTarget, event);
        }}
      >
        <img
          class="zen-library-row-icon"
          src=${
            record.image
              ? lazy.PlacesUIUtils.getImageURL(record.image)
              : `page-icon:${record.url}`
          }
          decoding="async"
          alt=""
        />
        <div class="zen-library-row-text">
          <span class="zen-library-row-title"
            >${record.customLabel || record.title || record.url}</span
          >
          <span class="zen-library-row-subtitle"
            ><span class="zen-library-visit-url"
              >${this.#formatUrl(record.url)}</span
            >${
              space
                ? html`<span class="zen-library-archive-space"
                    >${space.name}</span
                  >`
                : null
            }<span class="zen-library-visit-date"
              >${lazy.timeFormat.format(record.archivedAt)}</span
            ></span
          >
        </div>
        <div class="zen-library-row-actions">
          <toolbarbutton
            class="toolbarbutton-1"
            data-l10n-id="library-archive-delete-button"
            @click=${event => {
              event.stopPropagation();
              this.#delete(record);
            }}
          >
            <img
              class="toolbarbutton-icon"
              src="chrome://browser/skin/zen-icons/trash.svg"
              alt=""
            />
          </toolbarbutton>
          <toolbarbutton
            class="toolbarbutton-1"
            data-l10n-id="library-archive-restore-button"
            @click=${event => {
              event.stopPropagation();
              this.#restore(record, event);
            }}
          >
            <img
              class="toolbarbutton-icon"
              src="chrome://browser/skin/zen-icons/u-turn-to-left.svg"
              alt=""
            />
          </toolbarbutton>
        </div>
      </div>
    `;
  }

  renderItems() {
    if (!this.records) {
      return null;
    }
    if (!this.records.size) {
      return html`
        <div
          class="zen-library-empty"
          data-l10n-id=${
            this.searchQuery || this.activeFilters.size
              ? "library-archive-no-results"
              : "library-archive-empty"
          }
        ></div>
      `;
    }
    return repeat(
      this.records.entries(),
      ([day]) => day,
      ([day, records]) => html`
        <div class="zen-library-group">
          <h3>${this.#formatDay(day)}</h3>
          ${repeat(
            records,
            record => record.id,
            record => this.#renderRecord(record)
          )}
        </div>
      `
    );
  }
}

customElements.define("zen-library-archive-section", ZenLibraryArchiveSection);
