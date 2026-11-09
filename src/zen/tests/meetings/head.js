/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { gZenMeetings } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenMeetings.sys.mjs"
);
const { eventsBetween } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenCalendarFeed.sys.mjs"
);

const MINUTE = 60 * 1000;

/** @returns {string} A UTC date-time as iCalendar writes it */
function icsTime(time) {
  return new Date(time).toISOString().replace(/[-:]|\.\d+/g, "");
}

/**
 * @param {object[]} events - { uid, title, start, end, location }
 * @returns {string} A calendar with those events
 */
function makeCalendar(events) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0"];
  for (const { uid, title, start, end, location } of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `SUMMARY:${title}`,
      `DTSTART:${icsTime(start)}`,
      `DTEND:${icsTime(end)}`,
      `LOCATION:${location}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** @returns {string} An address the test server answers with `text` */
function calendarUrl(text, contentType = "text/calendar") {
  const root = getRootDirectory(gTestPath).replace(
    "chrome://mochitests/content",
    "https://example.com"
  );
  return `${root}file_calendar.sjs?type=${encodeURIComponent(contentType)}&body=${encodeURIComponent(text)}`;
}

/**
 * Points the meetings feature at a calendar with the given events and waits
 * for it to be read.
 */
async function useCalendar(events) {
  const changed = TestUtils.topicObserved("zen-meetings-changed");
  await SpecialPowers.pushPrefEnv({
    set: [["zen.meetings.calendar-urls", calendarUrl(makeCalendar(events))]],
  });
  await changed;
  await gZenMeetings.refresh();
}

function meetingCard() {
  return document.getElementById("zen-meeting-card");
}

registerCleanupFunction(async () => {
  await SpecialPowers.flushPrefEnv();
  gZenMeetings.resetForTesting();
  window.gZenMeetingCard.update();
});
