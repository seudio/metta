/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  Store,
  SyncEngine,
  Tracker,
} from "resource://services-sync/engines.sys.mjs";
import { CryptoWrapper } from "resource://services-sync/record.sys.mjs";
import { SCORE_INCREMENT_XLARGE } from "resource://services-sync/constants.sys.mjs";
import {
  ARCHIVE_CHANGED_TOPIC,
  RECORD_FIELDS,
  ZenTabArchiveStore,
} from "resource:///modules/zen/ZenTabArchiveStore.sys.mjs";

export class ZenTabArchiveSyncRecord extends CryptoWrapper {
  _logName = "Sync.Record.ZenTabArchive";
}

ZenTabArchiveSyncRecord.prototype.type = "tabarchive";

/**
 * Store for the Tab Archive engine. Each archived tab is one record, with the
 * same fields it has on disk. Restoring or deleting it here uploads a
 * tombstone, which removes it on the other devices.
 */
class ZenTabArchiveSyncStore extends Store {
  async getAllIDs() {
    await ZenTabArchiveStore.init();
    return Object.fromEntries(
      ZenTabArchiveStore.getAllIds().map(id => [id, true])
    );
  }

  async itemExists(id) {
    await ZenTabArchiveStore.init();
    return !!ZenTabArchiveStore.getRecord(id);
  }

  async createRecord(id, collection) {
    await ZenTabArchiveStore.init();
    const record = new ZenTabArchiveSyncRecord(collection, id);
    const archived = ZenTabArchiveStore.getRecord(id);
    if (!archived) {
      record.deleted = true;
      return record;
    }
    const cleartext = { id };
    for (const field of RECORD_FIELDS) {
      if (archived[field] !== undefined) {
        cleartext[field] = archived[field];
      }
    }
    record.cleartext = cleartext;
    return record;
  }

  async applyIncomingBatch(records, countTelemetry) {
    const failed = [];
    const removed = [];
    const added = [];
    for (const record of records) {
      if (record.deleted) {
        removed.push(record.id);
      } else if (record.cleartext?.url) {
        added.push({ ...record.cleartext, id: record.id });
      } else {
        failed.push(record.id);
        countTelemetry?.addIncomingFailedReason(`no url in ${record.id}`);
      }
    }
    try {
      await ZenTabArchiveStore.removeRecords(removed, { fromSync: true });
      await ZenTabArchiveStore.addRecords(added, { fromSync: true });
    } catch (e) {
      console.error("ZenTabArchiveSync: could not apply records:", e);
      // Unacknowledged, so the engine delivers them again next time.
      return records.map(record => record.id);
    }
    return failed;
  }

  async wipe() {
    // Never delete user data on an engine wipe.
  }

  async changeItemID() {}
}

/**
 * Tracker for the Tab Archive engine. The archive store keeps the set of ids
 * changed here, so the tracker only asks for a sync when that happens.
 */
class ZenTabArchiveSyncTracker extends Tracker {
  _ignoreAll = false;

  get ignoreAll() {
    return this._ignoreAll;
  }

  set ignoreAll(value) {
    this._ignoreAll = value;
  }

  onStart() {
    Services.obs.addObserver(this, ARCHIVE_CHANGED_TOPIC);
  }

  onStop() {
    Services.obs.removeObserver(this, ARCHIVE_CHANGED_TOPIC);
  }

  observe(subject, topic, data) {
    if (this.ignoreAll) {
      return;
    }
    let fromSync = false;
    try {
      fromSync = JSON.parse(data).fromSync;
    } catch {}
    if (!fromSync) {
      this.score += SCORE_INCREMENT_XLARGE;
    }
  }
}

export class ZenTabArchiveSyncEngine extends SyncEngine {
  /** The dirty set as it was when this sync collected its changes. */
  #sent = {};

  constructor(service) {
    super("TabArchive", service);
  }

  get _storeObj() {
    return ZenTabArchiveSyncStore;
  }

  get _trackerObj() {
    return ZenTabArchiveSyncTracker;
  }

  get _recordObj() {
    return ZenTabArchiveSyncRecord;
  }

  get version() {
    return 1;
  }

  get syncPriority() {
    // After Spaces, so the spaces a record points at already exist.
    return 9;
  }

  get allowSkippedRecord() {
    return true;
  }

  async getChangedIDs() {
    await ZenTabArchiveStore.init();
    const changed = {};
    this.#sent = ZenTabArchiveStore.getDirty();
    for (const [id, time] of Object.entries(this.#sent)) {
      changed[id] = time / 1000;
    }
    return changed;
  }

  async _reconcile(item) {
    // A tab restored or deleted here stays gone: a record coming back for it
    // is from a device that has not heard yet, and loses to the tombstone.
    if (!item.deleted && ZenTabArchiveStore.hasTombstone(item.id)) {
      return false;
    }
    // Otherwise what arrives wins. Records never change once written, so the
    // only conflict is a removal, and a removal anywhere applies everywhere.
    this._modified.delete(item.id);
    return true;
  }

  async trackRemainingChanges() {}

  async _onRecordsWritten(succeeded) {
    ZenTabArchiveStore.markUploaded(succeeded, this.#sent);
  }
}
