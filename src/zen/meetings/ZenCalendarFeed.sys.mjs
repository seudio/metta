// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Reads iCalendar (.ics) feeds: the private calendar addresses that Google
 * Calendar, Outlook and iCloud publish. Only what is needed to find the
 * meetings of the next day is supported: timed events, recurrence rules,
 * exceptions and cancellations, and the video call link of each event.
 */

const MS_PER_MINUTE = 60 * 1000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Recurring series can be years old; stop expanding one after this many
// periods rather than spin on a malformed rule.
const MAX_PERIODS = 5000;

// Outlook names its zones the Windows way. These are the common ones; any
// other zone falls back to the local time zone.
const WINDOWS_ZONES = {
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "Russian Standard Time": "Europe/Moscow",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "E. South America Standard Time": "America/Sao_Paulo",
  UTC: "UTC",
};

/**
 * Video call services, matched against every link in an event. The first
 * match in the most specific field wins.
 */
const PROVIDERS = [
  {
    name: "Zoom",
    pattern: /^https:\/\/([\w-]+\.)?zoom(gov)?\.(us|com)\/(j|my|w|s|wc)\//i,
  },
  {
    name: "Google Meet",
    pattern: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i,
  },
  {
    name: "Microsoft Teams",
    pattern:
      /^https:\/\/teams\.(microsoft|live)\.com\/(l\/meetup-join|meet)\//i,
  },
  {
    name: "Webex",
    pattern:
      /^https:\/\/[\w-]+\.webex\.com\/(meet|join|[\w-]+\/j\.php|wbxmjs)/i,
  },
  { name: "Slack", pattern: /^https:\/\/app\.slack\.com\/huddle\//i },
  { name: "Whereby", pattern: /^https:\/\/([\w-]+\.)?whereby\.com\/[\w-]+/i },
  { name: "Jitsi", pattern: /^https:\/\/meet\.jit\.si\/[\w-]+/i },
  { name: "Amazon Chime", pattern: /^https:\/\/chime\.aws\/\d+/i },
  {
    name: "GoTo Meeting",
    pattern:
      /^https:\/\/(meet\.goto\.com|global\.gotomeeting\.com\/join)\/\d+/i,
  },
  { name: "Around", pattern: /^https:\/\/(meet\.)?around\.co\/r\//i },
];

const URL_PATTERN = /https:\/\/[^\s<>"'\\]+/gi;

/**
 * @typedef {object} CalendarEvent
 * @property {string} uid - The event's identifier, shared by a series
 * @property {string} title - Its name, or empty
 * @property {number} start - Milliseconds since the epoch
 * @property {number} end - Milliseconds since the epoch
 * @property {string?} joinUrl - The video call link, if the event has one
 * @property {string?} provider - The video call service, e.g. "Zoom"
 */

/**
 * Splits a feed into its components, each a list of properties.
 *
 * @param {string} text
 * @returns {object[]} Components, as { type, properties, children }
 */
function parseComponents(text) {
  // Long lines continue on the next line after a space or tab.
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const root = { type: "ROOT", properties: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    if (!line) {
      continue;
    }
    const property = parseProperty(line);
    if (!property) {
      continue;
    }
    const current = stack.at(-1);
    if (property.name === "BEGIN") {
      const child = {
        type: property.value.toUpperCase(),
        properties: [],
        children: [],
      };
      current.children.push(child);
      stack.push(child);
    } else if (property.name === "END") {
      if (stack.length > 1) {
        stack.pop();
      }
    } else {
      current.properties.push(property);
    }
  }
  return root.children;
}

/**
 * @param {string} line - e.g. `DTSTART;TZID=Europe/Paris:20261109T100000`
 * @returns {object?} { name, params, value }
 */
function parseProperty(line) {
  let index = 0;
  let inQuotes = false;
  let nameEnd = -1;
  for (; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === ";" && nameEnd < 0) {
      nameEnd = index;
    } else if (!inQuotes && char === ":") {
      break;
    }
  }
  if (index >= line.length) {
    return null;
  }
  const head = line.slice(0, index);
  const value = line.slice(index + 1);
  const [name, ...rawParams] = head.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params = {};
  for (const param of rawParams) {
    const separator = param.indexOf("=");
    if (separator > 0) {
      params[param.slice(0, separator).toUpperCase()] = param
        .slice(separator + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (_, char) =>
    char === "n" || char === "N" ? "\n" : char
  );
}

/**
 * The offset of a time zone from UTC at a given moment.
 *
 * @param {number} time
 * @param {string} timeZone
 * @returns {number} Milliseconds to add to UTC to get the zone's wall time
 */
function zoneOffset(time, timeZone) {
  const parts = {};
  for (const { type, value } of zoneFormat(timeZone).formatToParts(time)) {
    parts[type] = value;
  }
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second
  );
  return asUTC - Math.floor(time / 1000) * 1000;
}

const zoneFormats = new Map();
function zoneFormat(timeZone) {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    zoneFormats.set(timeZone, format);
  }
  return format;
}

/**
 * @param {string?} tzid - The TZID parameter of a date
 * @returns {string?} An IANA zone name, or null for the local zone
 */
function resolveZone(tzid) {
  if (!tzid) {
    return null;
  }
  const name = WINDOWS_ZONES[tzid] ?? tzid.replace(/^\/[^/]*\//, "");
  try {
    zoneFormat(name);
    return name;
  } catch {
    return null;
  }
}

/**
 * A wall-clock time: what the calendar says, before applying a time zone.
 * Months are 1-based. Arithmetic on it goes through Date.UTC so that adding
 * days never crosses a daylight saving change.
 *
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} [hour]
 * @param {number} [minute]
 * @param {number} [second]
 * @returns {object} The wall time
 */
function wallTime(year, month, day, hour = 0, minute = 0, second = 0) {
  return { year, month, day, hour, minute, second };
}

function wallFromUTCDate(date, time) {
  return wallTime(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    time.hour,
    time.minute,
    time.second
  );
}

function addDays(wall, days) {
  return wallFromUTCDate(
    new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days)),
    wall
  );
}

function weekday(wall) {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

/**
 * @param {object} wall
 * @param {string?} timeZone - null for the local time zone
 * @returns {number} The moment that wall time names in that zone
 */
function wallToTime(wall, timeZone) {
  if (!timeZone) {
    return new Date(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second
    ).getTime();
  }
  const asUTC = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
  // Correct for the offset twice, so a time just after a daylight saving
  // change uses the offset in effect at that time.
  const guess = asUTC - zoneOffset(asUTC, timeZone);
  return asUTC - zoneOffset(guess, timeZone);
}

/**
 * @param {object} property - A date or date-time property
 * @returns {object?} { wall, zone, utc, allDay }
 */
function parseDateValue(property) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(
    property.value.trim()
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, utc] = match;
  const wall = wallTime(
    +year,
    +month,
    +day,
    +(hour ?? 0),
    +(minute ?? 0),
    +(second ?? 0)
  );
  return {
    wall,
    allDay: hour === undefined,
    zone: utc ? "UTC" : resolveZone(property.params.TZID),
  };
}

function parseDateList(property) {
  return property.value
    .split(",")
    .map(value => parseDateValue({ ...property, value }));
}

/**
 * @param {string} value
 * @returns {number} Milliseconds, from an ISO 8601 duration like PT1H30M
 */
function parseDuration(value) {
  const match =
    /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim()
    );
  if (!match) {
    return 0;
  }
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total =
    ((+(weeks ?? 0) * 7 + +(days ?? 0)) * 24 + +(hours ?? 0)) *
      60 *
      MS_PER_MINUTE +
    +(minutes ?? 0) * MS_PER_MINUTE +
    +(seconds ?? 0) * 1000;
  return sign === "-" ? -total : total;
}

function parseRule(value) {
  const rule = {};
  for (const part of value.split(";")) {
    const [key, partValue] = part.split("=");
    if (key && partValue) {
      rule[key.toUpperCase()] = partValue.toUpperCase();
    }
  }
  return rule;
}

/**
 * The days of a month a BYDAY list such as "2TU" or "-1FR,MO" picks.
 *
 * @param {number} year
 * @param {number} month - 1 to 12
 * @param {string} byDay - The rule's BYDAY list
 * @returns {number[]} Days of the month
 */
function monthDaysForByDay(year, month, byDay) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (const entry of byDay.split(",")) {
    const match = /^([+-]?\d+)?([A-Z]{2})$/.exec(entry);
    if (!match) {
      continue;
    }
    const target = WEEKDAYS.indexOf(match[2]);
    const matching = [];
    for (let day = 1; day <= daysInMonth; day++) {
      if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === target) {
        matching.push(day);
      }
    }
    if (!match[1]) {
      days.push(...matching);
    } else {
      const nth = +match[1];
      const day = nth > 0 ? matching[nth - 1] : matching.at(nth);
      if (day) {
        days.push(day);
      }
    }
  }
  return days.sort((a, b) => a - b);
}

/**
 * The start times of a recurring event, as wall times, in order. Yields
 * until the rule ends or the caller stops asking.
 *
 * @param {object} start - The first occurrence's wall time
 * @param {object} rule - The parsed RRULE
 * @yields {object} The wall time of each occurrence
 */
function* recurrenceWallTimes(start, rule) {
  const interval = Math.max(1, +(rule.INTERVAL ?? 1));
  const startKey = wallKey(start);
  for (let period = 0; period < MAX_PERIODS; period++) {
    let candidates;
    switch (rule.FREQ) {
      case "DAILY": {
        const day = addDays(start, period * interval);
        // "Every weekday" is sometimes written as a daily rule with days.
        const allowed = rule.BYDAY?.split(",").map(entry => entry.slice(-2));
        candidates =
          !allowed || allowed.includes(WEEKDAYS[weekday(day)]) ? [day] : [];
        break;
      }
      case "WEEKLY": {
        // Weeks start on Monday unless the rule says otherwise.
        const weekStart = WEEKDAYS.indexOf(rule.WKST ?? "MO");
        const offset = (weekday(start) - weekStart + 7) % 7;
        const firstDay = addDays(start, period * interval * 7 - offset);
        const days = rule.BYDAY
          ? rule.BYDAY.split(",").map(day => WEEKDAYS.indexOf(day.slice(-2)))
          : [weekday(start)];
        candidates = days
          .map(day => addDays(firstDay, (day - weekStart + 7) % 7))
          .sort((a, b) => wallKey(a) - wallKey(b));
        break;
      }
      case "MONTHLY": {
        const monthIndex = start.month - 1 + period * interval;
        const year = start.year + Math.floor(monthIndex / 12);
        const month = (monthIndex % 12) + 1;
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        let days;
        if (rule.BYDAY) {
          days = monthDaysForByDay(year, month, rule.BYDAY);
          if (rule.BYSETPOS) {
            const position = +rule.BYSETPOS;
            const day = position > 0 ? days[position - 1] : days.at(position);
            days = day ? [day] : [];
          }
        } else {
          days = (rule.BYMONTHDAY ?? String(start.day))
            .split(",")
            .map(day => (+day < 0 ? daysInMonth + 1 + +day : +day))
            .filter(day => day >= 1 && day <= daysInMonth)
            .sort((a, b) => a - b);
        }
        candidates = days.map(day =>
          wallTime(year, month, day, start.hour, start.minute, start.second)
        );
        break;
      }
      case "YEARLY": {
        const year = start.year + period * interval;
        const daysInMonth = new Date(
          Date.UTC(year, start.month, 0)
        ).getUTCDate();
        candidates =
          start.day <= daysInMonth
            ? [
                wallTime(
                  year,
                  start.month,
                  start.day,
                  start.hour,
                  start.minute,
                  start.second
                ),
              ]
            : [];
        break;
      }
      default:
        return;
    }
    for (const candidate of candidates) {
      if (wallKey(candidate) >= startKey) {
        yield candidate;
      }
    }
  }
}

function wallKey(wall) {
  return Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
}

/**
 * Finds the video call link of an event.
 *
 * @param {object} event - The VEVENT component
 * @returns {object?} { url, provider }
 */
function findJoinLink(event) {
  // Most specific first: Google and RFC 7986 conference properties, then the
  // event's own link, then its location and description.
  const fields = [
    "X-GOOGLE-CONFERENCE",
    "CONFERENCE",
    "URL",
    "LOCATION",
    "DESCRIPTION",
    "X-ALT-DESC",
  ];
  for (const field of fields) {
    for (const property of event.properties) {
      if (property.name !== field) {
        continue;
      }
      const text = unescapeText(property.value).replace(/&amp;/g, "&");
      for (const [candidate] of text.matchAll(URL_PATTERN)) {
        const url = candidate.replace(/[).,;\]>]+$/, "");
        const provider = PROVIDERS.find(({ pattern }) => pattern.test(url));
        if (provider) {
          return { url, provider: provider.name };
        }
      }
    }
  }
  return null;
}

function firstProperty(component, name) {
  return component.properties.find(property => property.name === name);
}

/**
 * The meetings in a feed that overlap a window of time, soonest first.
 * All-day events and cancelled ones are left out.
 *
 * @param {string} text - The .ics feed
 * @param {number} from - Start of the window, in milliseconds
 * @param {number} to - End of the window
 * @returns {CalendarEvent[]}
 */
export function eventsBetween(text, from, to) {
  const calendars = parseComponents(text).filter(
    ({ type }) => type === "VCALENDAR"
  );
  const results = [];
  for (const calendar of calendars) {
    const defaultZone = resolveZone(
      firstProperty(calendar, "X-WR-TIMEZONE")?.value
    );
    const events = calendar.children.filter(({ type }) => type === "VEVENT");

    // Edited or cancelled occurrences of a series, by series and start time,
    // and the last one each series has.
    const overrides = { byKey: new Map(), lastByUid: new Map() };
    for (const event of events) {
      const recurrenceId = firstProperty(event, "RECURRENCE-ID");
      const uid = firstProperty(event, "UID")?.value;
      if (!recurrenceId || !uid) {
        continue;
      }
      const date = parseDateValue(recurrenceId);
      if (date) {
        const time = wallToTime(date.wall, date.zone ?? defaultZone);
        overrides.byKey.set(`${uid} ${time}`, event);
        overrides.lastByUid.set(
          uid,
          Math.max(time, overrides.lastByUid.get(uid) ?? -Infinity)
        );
      }
    }

    for (const event of events) {
      if (firstProperty(event, "RECURRENCE-ID")) {
        // Handled below, with its series, or on its own when the series
        // itself is not in the feed.
        const uid = firstProperty(event, "UID")?.value;
        const seriesInFeed = events.some(
          other =>
            other !== event &&
            firstProperty(other, "UID")?.value === uid &&
            !firstProperty(other, "RECURRENCE-ID")
        );
        if (seriesInFeed) {
          continue;
        }
      }
      results.push(...occurrences(event, overrides, defaultZone, from, to));
    }
  }
  return results.sort((a, b) => a.start - b.start);
}

function occurrences(event, overrides, defaultZone, from, to) {
  const startProperty = firstProperty(event, "DTSTART");
  const start = startProperty && parseDateValue(startProperty);
  if (!start || start.allDay) {
    return [];
  }
  const zone = start.zone ?? defaultZone;
  const startTime = wallToTime(start.wall, zone);
  const endProperty = firstProperty(event, "DTEND");
  const end = endProperty && parseDateValue(endProperty);
  const durationProperty = firstProperty(event, "DURATION");
  let duration = 0;
  if (end) {
    duration = wallToTime(end.wall, end.zone ?? defaultZone) - startTime;
  } else if (durationProperty) {
    duration = parseDuration(durationProperty.value);
  }
  const uid = firstProperty(event, "UID")?.value ?? "";
  const ruleProperty = firstProperty(event, "RRULE");
  const results = [];

  const add = (component, occurrenceStart, occurrenceEnd) => {
    if (
      firstProperty(component, "STATUS")?.value.toUpperCase() === "CANCELLED"
    ) {
      return;
    }
    if (occurrenceEnd <= from || occurrenceStart >= to) {
      return;
    }
    // An edited occurrence often leaves out what it shares with its series.
    const link =
      findJoinLink(component) ??
      (component === event ? null : findJoinLink(event));
    results.push({
      uid,
      title: unescapeText(
        firstProperty(component, "SUMMARY")?.value ?? ""
      ).trim(),
      start: occurrenceStart,
      end: occurrenceEnd,
      joinUrl: link?.url ?? null,
      provider: link?.provider ?? null,
    });
  };

  if (!ruleProperty || firstProperty(event, "RECURRENCE-ID")) {
    add(event, startTime, startTime + duration);
    return results;
  }

  const rule = parseRule(ruleProperty.value);
  const until = rule.UNTIL
    ? parseDateValue({ params: {}, value: rule.UNTIL })
    : null;
  let untilTime = Infinity;
  if (until?.allDay) {
    // The whole of the last day counts.
    untilTime = wallToTime(addDays(until.wall, 1), zone) - 1;
  } else if (until) {
    untilTime = wallToTime(until.wall, until.zone ?? zone);
  }
  const count = rule.COUNT ? +rule.COUNT : Infinity;

  const excluded = new Set();
  for (const property of event.properties) {
    if (property.name === "EXDATE") {
      for (const date of parseDateList(property)) {
        if (date) {
          excluded.add(wallToTime(date.wall, date.zone ?? zone));
        }
      }
    }
  }

  // An occurrence due after the window can have been moved into it, so the
  // series is followed as far as its last edited occurrence.
  const lastToCheck = Math.max(to, (overrides.lastByUid.get(uid) ?? 0) + 1);
  let seen = 0;
  for (const wall of recurrenceWallTimes(start.wall, rule)) {
    const occurrenceStart = wallToTime(wall, zone);
    if (
      occurrenceStart > untilTime ||
      seen >= count ||
      occurrenceStart >= lastToCheck
    ) {
      break;
    }
    seen++;
    if (excluded.has(occurrenceStart)) {
      continue;
    }
    const override = overrides.byKey.get(`${uid} ${occurrenceStart}`);
    if (override) {
      const overrideStart = parseDateValue(firstProperty(override, "DTSTART"));
      const overrideEnd = firstProperty(override, "DTEND");
      const movedStart = overrideStart
        ? wallToTime(overrideStart.wall, overrideStart.zone ?? zone)
        : occurrenceStart;
      const movedEnd = overrideEnd
        ? wallToTime(
            parseDateValue(overrideEnd).wall,
            parseDateValue(overrideEnd).zone ?? zone
          )
        : movedStart + duration;
      add(override, movedStart, movedEnd);
      continue;
    }
    add(event, occurrenceStart, occurrenceStart + duration);
  }
  return results;
}

/**
 * @param {string} url
 * @returns {string?} The video call service a link belongs to
 */
export function meetingProvider(url) {
  return PROVIDERS.find(({ pattern }) => pattern.test(url))?.name ?? null;
}
