/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// A Google Calendar export: a weekly series with one occurrence moved and
// one skipped, in the calendar's own time zone.
const GOOGLE_FEED = [
  "BEGIN:VCALENDAR",
  "X-WR-TIMEZONE:America/Los_Angeles",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Los_Angeles:20260105T093000",
  "DTEND;TZID=America/Los_Angeles:20260105T100000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
  "EXDATE;TZID=America/Los_Angeles:20261111T093000",
  "UID:standup@google.com",
  "SUMMARY:Team standup",
  "DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij\\nOr",
  "  dial: (US) +1 555-0100",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Los_Angeles:20261109T140000",
  "DTEND;TZID=America/Los_Angeles:20261109T143000",
  "RECURRENCE-ID;TZID=America/Los_Angeles:20261109T093000",
  "UID:standup@google.com",
  "SUMMARY:Team standup (moved)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Pacific Standard Time:20261110T110000",
  "DTEND;TZID=Pacific Standard Time:20261110T113000",
  "UID:teams",
  "SUMMARY:1:1",
  "DESCRIPTION:Join: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=%7b%7d>",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261109",
  "UID:all-day",
  "SUMMARY:Holiday",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261109T210000Z",
  "DURATION:PT45M",
  "UID:cancelled",
  "STATUS:CANCELLED",
  "SUMMARY:Cancelled",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const at = iso => new Date(iso).getTime();

add_task(function test_a_week_of_meetings() {
  const events = eventsBetween(
    GOOGLE_FEED,
    at("2026-11-09T00:00:00-08:00"),
    at("2026-11-17T00:00:00-08:00")
  );
  Assert.deepEqual(
    events.map(({ title, start }) => [title, new Date(start).toISOString()]),
    [
      ["Team standup (moved)", "2026-11-09T22:00:00.000Z"],
      ["1:1", "2026-11-10T19:00:00.000Z"],
      ["Team standup", "2026-11-16T17:30:00.000Z"],
    ],
    "Moved and skipped occurrences, Outlook zone names, all-day and cancelled events"
  );
  is(
    events[0].provider,
    "Google Meet",
    "A moved occurrence keeps the series link"
  );
  is(events[0].joinUrl, "https://meet.google.com/abc-defg-hij");
  is(events[0].end - events[0].start, 30 * MINUTE, "It keeps its own length");
  is(events[1].provider, "Microsoft Teams");
  ok(
    !events[1].joinUrl.endsWith(">"),
    "Brackets around a link are not part of it"
  );
});

add_task(function test_recurring_meetings_keep_their_local_time_over_dst() {
  const events = eventsBetween(
    GOOGLE_FEED,
    at("2026-03-09T00:00:00-07:00"),
    at("2026-03-10T00:00:00-07:00")
  );
  is(
    new Date(events[0].start).toISOString(),
    "2026-03-09T16:30:00.000Z",
    "9:30 in Los Angeles after the switch to daylight time"
  );
});

add_task(function test_monthly_rules() {
  const feed = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART:20260310T160000Z",
    "DTEND:20260310T163000Z",
    "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=12",
    "UID:monthly",
    "SUMMARY:Monthly review",
    "LOCATION:https://zoom.us/j/123",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = eventsBetween(
    feed,
    at("2026-11-01T00:00:00Z"),
    at("2026-12-01T00:00:00Z")
  );
  is(events.length, 1, "One occurrence in November");
  is(
    new Date(events[0].start).toISOString(),
    "2026-11-10T16:00:00.000Z",
    "On the second Tuesday"
  );
  is(
    eventsBetween(feed, at("2027-04-01T00:00:00Z"), at("2027-05-01T00:00:00Z"))
      .length,
    0,
    "The series ends after 12 occurrences"
  );
});
