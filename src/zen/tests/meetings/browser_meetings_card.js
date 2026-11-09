/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const ZOOM_LINK = "https://us02web.zoom.us/j/81234567890?pwd=abc";

add_task(async function test_the_card_appears_shortly_before_a_meeting() {
  const now = Date.now();
  await useCalendar([
    {
      uid: "soon",
      title: "Design review",
      start: now + 3 * MINUTE + 10000,
      end: now + 33 * MINUTE,
      location: ZOOM_LINK,
    },
    {
      uid: "later",
      title: "Later today",
      start: now + 60 * MINUTE,
      end: now + 90 * MINUTE,
      location: ZOOM_LINK,
    },
  ]);

  const card = meetingCard();
  ok(
    BrowserTestUtils.isVisible(card),
    "The card shows a meeting starting in 3 minutes"
  );
  is(
    card.querySelector(".zen-meeting-title").value,
    "Design review",
    "It names the meeting"
  );
  is(
    card.querySelector(".zen-meeting-provider").value,
    "Zoom",
    "It names the video service"
  );
  await TestUtils.waitForCondition(
    () => card.querySelector(".zen-meeting-when").value == "In 3 min",
    "It says when the meeting starts"
  );
  ok(!card.hasAttribute("started"), "The meeting has not started");
});

add_task(
  async function test_meetings_without_a_link_or_far_away_have_no_card() {
    const now = Date.now();
    await useCalendar([
      {
        uid: "room",
        title: "In person",
        start: now + MINUTE,
        end: now + 30 * MINUTE,
        location: "Room 4",
      },
      {
        uid: "far",
        title: "Tomorrow",
        start: now + 20 * MINUTE,
        end: now + 50 * MINUTE,
        location: ZOOM_LINK,
      },
      {
        uid: "over",
        title: "Already over",
        start: now - 60 * MINUTE,
        end: now - MINUTE,
        location: ZOOM_LINK,
      },
    ]);
    ok(BrowserTestUtils.isHidden(meetingCard()), "No card for these meetings");
  }
);

add_task(async function test_a_meeting_in_progress_keeps_its_card() {
  const now = Date.now();
  await useCalendar([
    {
      uid: "started",
      title: "Standup",
      start: now - 4 * MINUTE,
      end: now + 11 * MINUTE,
      location: "https://meet.google.com/abc-defg-hij",
    },
  ]);
  const card = meetingCard();
  ok(BrowserTestUtils.isVisible(card), "The card stays until the meeting ends");
  ok(card.hasAttribute("started"), "It is marked as started");
  is(card.querySelector(".zen-meeting-provider").value, "Google Meet");
});

add_task(async function test_join_opens_the_link_and_hides_the_card() {
  const now = Date.now();
  await useCalendar([
    {
      uid: "join",
      title: "Customer call",
      start: now + MINUTE,
      end: now + 31 * MINUTE,
      location: ZOOM_LINK,
    },
  ]);
  const card = meetingCard();
  ok(BrowserTestUtils.isVisible(card), "The card is shown");

  // Opening the real link would leave the test's network sandbox.
  const opened = [];
  const original = window.openTrustedLinkIn;
  window.openTrustedLinkIn = (url, where) => opened.push({ url, where });
  try {
    card.querySelector(".zen-meeting-join").doCommand();
  } finally {
    window.openTrustedLinkIn = original;
  }
  Assert.deepEqual(
    opened,
    [{ url: ZOOM_LINK, where: "tab" }],
    "Join opens the meeting in a tab"
  );
  ok(BrowserTestUtils.isHidden(card), "The card is gone once joined");
});

add_task(async function test_dismissing_hides_the_card_in_every_window() {
  const now = Date.now();
  await useCalendar([
    {
      uid: "dismiss",
      title: "Optional sync",
      start: now + 2 * MINUTE,
      end: now + 32 * MINUTE,
      location: ZOOM_LINK,
    },
  ]);
  ok(BrowserTestUtils.isVisible(meetingCard()), "The card is shown");

  meetingCard().querySelector(".zen-meeting-close").doCommand();
  ok(BrowserTestUtils.isHidden(meetingCard()), "The card is hidden");
  // Every window's card shows this, so they all hide it.
  is(gZenMeetings.currentMeeting, null, "No window has a meeting to show");
});

add_task(async function test_the_status_counts_todays_meetings() {
  const now = Date.now();
  await useCalendar([
    {
      uid: "status",
      title: "Status",
      start: now + MINUTE,
      end: now + 2 * MINUTE,
      location: ZOOM_LINK,
    },
  ]);
  const status = gZenMeetings.status;
  is(status.calendars, 1, "One calendar");
  Assert.deepEqual(status.errors, [], "It loaded");
  is(status.meetingsToday, 1, "One meeting with a link left today");

  const changed = TestUtils.topicObserved("zen-meetings-changed");
  await SpecialPowers.pushPrefEnv({
    set: [
      [
        "zen.meetings.calendar-urls",
        calendarUrl("<html>Sign in</html>", "text/html"),
      ],
    ],
  });
  await changed;
  await gZenMeetings.refresh();
  is(
    gZenMeetings.status.failed,
    1,
    "A feed that is not a calendar is reported"
  );
});
