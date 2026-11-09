/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

ChromeUtils.defineLazyGetter(
  lazy,
  "profileDir",
  () => Services.dirsvc.get("ProfD", Ci.nsIFile).path
);

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "retentionDays",
  "zen.tabs.auto-archive.retention-days",
  90
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "maxRecords",
  "zen.tabs.auto-archive.max-records",
  5000
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "debug",
  "zen.tabs.auto-archive.debug",
  false
);

const FILE_NAME = "zen-archive.jsonlz4";
const BACKUP_NAME = "zen-archive.baklz4";
const CORRUPT_NAME = "zen-archive.corrupt.jsonlz4";
const STORE_VERSION = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How many sleep or shutdown gaps are remembered for idle time. */
const MAX_PAUSES = 200;

/** Fired with `{ids, fromSync}` as JSON whenever records change. */
export const ARCHIVE_CHANGED_TOPIC = "zen-tab-archive-changed";

/** The fields of a record that travel to disk and through Sync. */
export const RECORD_FIELDS = [
  "url",
  "title",
  "image",
  "workspaceId",
  "userContextId",
  "containerName",
  "customLabel",
  "lastActivity",
  "archivedAt",
  "reason",
];

export function archiveLog(...args) {
  if (lazy.debug) {
    // eslint-disable-next-line no-console
    console.log("[ZenTabArchive]", ...args);
  }
}

/**
 * @param {number[][]} pauses - [start, end] gaps, in any order
 * @returns {number[][]} The same time covered once, oldest first. Two gaps
 *   that overlap would otherwise be subtracted twice from a tab's idle time.
 */
function mergePauses(pauses) {
  const merged = [];
  const valid = pauses.filter(
    pause => Array.isArray(pause) && pause[1] > pause[0]
  );
  for (const [start, end] of valid.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function emptyData() {
  return {
    version: STORE_VERSION,
    records: {},
    // Ids deleted or restored here, kept so Sync can tell other devices.
    tombstones: {},
    // Ids changed here that Sync has not uploaded yet.
    dirty: {},
    // [start, end] gaps when the browser was asleep or not running.
    pauses: [],
  };
}

/**
 * Keeps the archive of tabs closed by Auto Archive: one compressed JSON file
 * in the profile, holding what is needed to reopen each tab and nothing of
 * the page itself.
 */
class nsZenTabArchiveStore {
  #data = emptyData();
  #initPromise = null;
  #writeChain = Promise.resolve();
  #placesListener = null;

  get #path() {
    return PathUtils.join(lazy.profileDir, FILE_NAME);
  }

  get #backupPath() {
    return PathUtils.join(lazy.profileDir, BACKUP_NAME);
  }

  /** @returns {Promise<void>} Resolves once the archive has been read */
  init() {
    this.#initPromise ??= this.#init();
    return this.#initPromise;
  }

  async #init() {
    this.#data = await this.#read();
    this.#prune();
    this.#placesListener = events => this.#onPlacesEvents(events);
    lazy.PlacesUtils.observers.addListener(
      ["history-cleared", "page-removed"],
      this.#placesListener
    );
    lazy.AsyncShutdown.profileBeforeChange.addBlocker(
      "ZenTabArchiveStore: writing the archive",
      () => this.#writeChain
    );
  }

  /**
   * Reads the archive, falling back to the copy kept from the last good
   * write. When neither can be read, the broken file is moved aside and the
   * archive starts empty, so open tabs are never affected.
   *
   * @returns {Promise<object>} The archive data
   */
  async #read() {
    for (const path of [this.#path, this.#backupPath]) {
      try {
        const data = await IOUtils.readJSON(path, { decompress: true });
        if (data?.version !== STORE_VERSION || !data.records) {
          throw new Error(`Unknown archive version ${data?.version}`);
        }
        return { ...emptyData(), ...data };
      } catch (e) {
        if (DOMException.isInstance(e) && e.name === "NotFoundError") {
          if (
            path === this.#path &&
            !(await IOUtils.exists(this.#backupPath))
          ) {
            return emptyData();
          }
          continue;
        }
        console.error(`ZenTabArchiveStore: could not read ${path}:`, e);
      }
    }
    if (await IOUtils.exists(this.#path)) {
      try {
        await IOUtils.move(
          this.#path,
          PathUtils.join(lazy.profileDir, CORRUPT_NAME)
        );
      } catch (e) {
        console.error("ZenTabArchiveStore: could not move the archive:", e);
      }
    }
    return emptyData();
  }

  /**
   * Writes the archive. Writes run one after another, each to a temporary
   * file first, and the previous file is kept as the backup.
   *
   * @returns {Promise<void>} Rejects when the write failed
   */
  #write() {
    const write = this.#writeChain.then(() =>
      IOUtils.writeJSON(this.#path, this.#data, {
        compress: true,
        tmpPath: `${this.#path}.tmp`,
        backupFile: this.#backupPath,
      })
    );
    // A failed write must not stop the ones queued after it.
    this.#writeChain = write.catch(() => {});
    return write;
  }

  #notify(ids, fromSync = false) {
    Services.obs.notifyObservers(
      null,
      ARCHIVE_CHANGED_TOPIC,
      JSON.stringify({ ids, fromSync })
    );
  }

  /** Drops records past retention, and the oldest above the cap. */
  #prune() {
    const now = Date.now();
    const cutoff = now - lazy.retentionDays * MS_PER_DAY;
    const records = this.#data.records;
    for (const [id, record] of Object.entries(records)) {
      if (record.archivedAt < cutoff) {
        delete records[id];
      }
    }
    const ids = Object.keys(records);
    if (ids.length > lazy.maxRecords) {
      ids
        .sort((a, b) => records[a].archivedAt - records[b].archivedAt)
        .slice(0, ids.length - lazy.maxRecords)
        .forEach(id => delete records[id]);
    }
    for (const [id, deletedAt] of Object.entries(this.#data.tombstones)) {
      if (deletedAt < cutoff) {
        delete this.#data.tombstones[id];
      }
    }
    // Sync need not hear of what has aged out, and with Sync off nothing
    // else would ever clear these.
    for (const id of Object.keys(this.#data.dirty)) {
      if (!(id in records) && !(id in this.#data.tombstones)) {
        delete this.#data.dirty[id];
      }
    }
    this.#data.pauses = mergePauses(this.#data.pauses)
      .filter(([, end]) => end >= cutoff)
      .slice(-MAX_PAUSES);
  }

  /** @returns {object[]} Every record, newest first */
  getRecords() {
    return Object.entries(this.#data.records)
      .map(([id, record]) => ({ id, ...record }))
      .sort((a, b) => b.archivedAt - a.archivedAt);
  }

  /**
   * @param {string} id
   * @returns {object?} That record, if the archive has it
   */
  getRecord(id) {
    const record = this.#data.records[id];
    return record ? { id, ...record } : null;
  }

  /** @returns {string[]} The ids of every record and tombstone */
  getAllIds() {
    return [
      ...Object.keys(this.#data.records),
      ...Object.keys(this.#data.tombstones),
    ];
  }

  /**
   * Saves new records. Resolves only once they are on disk, so a tab is
   * never closed before its record exists.
   *
   * @param {object[]} records - Records with an `id` and `RECORD_FIELDS`
   * @param {object} [options]
   * @param {boolean} [options.fromSync] - The records came from Sync
   * @returns {Promise<void>} Rejects, with nothing kept, if the write failed
   */
  async addRecords(records, { fromSync = false } = {}) {
    await this.init();
    if (!records.length) {
      return;
    }
    const before = {
      records: { ...this.#data.records },
      tombstones: { ...this.#data.tombstones },
      dirty: { ...this.#data.dirty },
    };
    for (const record of records) {
      this.#data.records[record.id] = this.#clean(record);
      delete this.#data.tombstones[record.id];
      if (!fromSync) {
        this.#data.dirty[record.id] = Date.now();
      }
    }
    this.#prune();
    try {
      await this.#write();
    } catch (e) {
      Object.assign(this.#data, before);
      throw e;
    }
    this.#notify(
      records.map(record => record.id),
      fromSync
    );
  }

  /**
   * Removes records, after a restore or a delete.
   *
   * @param {string[]} ids
   * @param {object} [options]
   * @param {boolean} [options.fromSync] - The removal came from Sync
   * @param {boolean} [options.discard] - The records were just added for
   *   tabs that stayed open, so other devices need not hear of them unless
   *   they already have
   * @returns {Promise<void>}
   */
  async removeRecords(ids, { fromSync = false, discard = false } = {}) {
    await this.init();
    const removed = ids.filter(id => id in this.#data.records);
    const wasRecord = new Set(removed);
    for (const id of ids) {
      delete this.#data.records[id];
      if (fromSync || (discard && id in this.#data.dirty)) {
        delete this.#data.tombstones[id];
        delete this.#data.dirty[id];
      } else if (wasRecord.has(id)) {
        this.#data.tombstones[id] = Date.now();
        this.#data.dirty[id] = Date.now();
      }
    }
    if (!removed.length) {
      return;
    }
    await this.#write().catch(e =>
      console.error("ZenTabArchiveStore: could not save a removal:", e)
    );
    this.#notify(removed, fromSync);
  }

  /** Removes every record, as Clear History asks. */
  async clear() {
    await this.removeRecords(Object.keys(this.#data.records));
  }

  #clean(record) {
    const clean = {};
    for (const field of RECORD_FIELDS) {
      if (record[field] !== undefined && record[field] !== null) {
        clean[field] = record[field];
      }
    }
    return clean;
  }

  /**
   * Clearing history clears the archive too: all of it, or the records of
   * the pages the user removed. Pages that only expired are left alone.
   *
   * @param {PlacesEvent[]} events
   */
  #onPlacesEvents(events) {
    const urls = new Set();
    for (const event of events) {
      if (event.type === "history-cleared") {
        this.clear().catch(console.error);
        return;
      }
      if (
        event.type === "page-removed" &&
        event.isRemovedFromStore &&
        event.reason === event.REASON_DELETED
      ) {
        urls.add(event.url);
      }
    }
    if (!urls.size) {
      return;
    }
    const ids = Object.entries(this.#data.records)
      .filter(([, record]) => urls.has(record.url))
      .map(([id]) => id);
    if (ids.length) {
      this.removeRecords(ids).catch(console.error);
    }
  }

  /**
   * Remembers a gap when the browser was asleep or not running, so idle
   * time skips it.
   *
   * @param {number} start
   * @param {number} end
   */
  addPause(start, end) {
    if (!(end > start)) {
      return;
    }
    this.#data.pauses.push([start, end]);
    this.#prune();
    this.#write().catch(e =>
      console.error("ZenTabArchiveStore: could not save a pause:", e)
    );
  }

  /**
   * @param {number} since - When the tab was last active
   * @param {number} [now]
   * @returns {number} Milliseconds since then that the browser ran
   */
  runningTimeSince(since, now = Date.now()) {
    let paused = 0;
    for (const [start, end] of this.#data.pauses) {
      const overlap = Math.min(end, now) - Math.max(start, since);
      if (overlap > 0) {
        paused += overlap;
      }
    }
    // A clock set back must not make anything older than it is.
    return Math.max(0, now - since - paused);
  }

  // Sync bookkeeping, used by ZenTabArchiveSync.sys.mjs.

  /** @returns {object} Ids changed here since the last upload, with times */
  getDirty() {
    return { ...this.#data.dirty };
  }

  /**
   * @param {string[]} ids - Ids Sync has just uploaded
   * @param {object} sent - `getDirty()` as it was when the upload started; an
   *   id changed again since then stays dirty
   */
  markUploaded(ids, sent) {
    for (const id of ids) {
      if (this.#data.dirty[id] === sent[id]) {
        delete this.#data.dirty[id];
      }
    }
    this.#write().catch(e =>
      console.error("ZenTabArchiveStore: could not save sync state:", e)
    );
  }

  /** Forgets the remembered pauses. Used by tests. */
  clearPausesForTests() {
    this.#data.pauses = [];
  }

  /**
   * @param {string} id
   * @returns {boolean} Whether that record was restored or deleted here
   */
  hasTombstone(id) {
    return id in this.#data.tombstones;
  }

  /** @returns {object} Tombstones with their deletion times */
  getTombstones() {
    return { ...this.#data.tombstones };
  }
}

export const ZenTabArchiveStore = new nsZenTabArchiveStore();
