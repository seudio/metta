/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PAGE = "https://example.com/";

const SERIOUS = {
  announced: "November 10, 2026",
  cves: [{ id: "CVE-2026-1001", level: "high", title: "Sandbox escape" }],
};

const EXPLOITED = {
  announced: "November 10, 2026",
  cves: [
    {
      id: "CVE-2026-2002",
      level: "critical",
      title: "Use-after-free",
      note: "We are aware of this issue being exploited in the wild.",
    },
  ],
};

const RELEASES = [
  { version: "160.0.1", id: "mfsa2026-130", level: "high" },
  { version: "160", id: "mfsa2026-125", level: "high" },
];

add_task(async function test_an_up_to_date_build_is_left_alone() {
  await useFeeds({ version: "160.0.1", releases: RELEASES, advisory: SERIOUS });
  const asked = answerPrompts(0);
  await gZenSecurityWatch.check();
  await TestUtils.waitForTick();

  is(gZenSecurityWatch.state.action, "none", "Nothing is missing");
  is(asked.length, 0, "Nothing is asked");
  ok(!gZenSecurityWatch.blocking, "Nothing is blocked");
});

add_task(async function test_a_missing_serious_fix_is_asked_about_once() {
  await useFeeds({ version: "160", releases: RELEASES, advisory: SERIOUS });
  const asked = answerPrompts(0);
  await gZenSecurityWatch.check();
  await TestUtils.waitForCondition(() => asked.length == 1, "It asks");

  ok(asked[0].body.includes("160.0.1"), "It names the release with the fix");
  ok(!gZenSecurityWatch.blocking, "A fix nobody is exploiting does not block");
  ok(BrowserTestUtils.isHidden(blockScreen()), "Pages stay open");

  await gZenSecurityWatch.check();
  await TestUtils.waitForTick();
  is(asked.length, 1, "Having continued, it does not ask again");
});

add_task(async function test_postponing_asks_again_a_day_later() {
  await useFeeds({ version: "160", releases: RELEASES, advisory: SERIOUS });
  const asked = answerPrompts(1);
  await gZenSecurityWatch.check();
  await TestUtils.waitForCondition(() => asked.length == 1, "It asks");

  await gZenSecurityWatch.check();
  await TestUtils.waitForTick();
  is(asked.length, 1, "Not again the same day");

  const later = Date.now() + 25 * 60 * 60 * 1000;
  gZenSecurityWatch.now = () => later;
  await gZenSecurityWatch.check();
  await TestUtils.waitForCondition(() => asked.length == 2, "It asks again");
});

add_task(
  async function test_a_fix_within_its_grace_period_is_not_asked_about() {
    await useFeeds({
      version: "160",
      releases: RELEASES,
      advisory: SERIOUS,
      graceDays: 3,
    });
    const asked = answerPrompts(0);
    const announced = new Date("2026-11-10T00:00:00Z").getTime();
    gZenSecurityWatch.now = () => announced + DAY;
    await gZenSecurityWatch.check();
    await TestUtils.waitForTick();

    is(gZenSecurityWatch.state.action, "notice", "It is only noted");
    is(asked.length, 0, "Nothing is asked yet");
  }
);

add_task(async function test_an_exploited_bug_pauses_browsing() {
  await useFeeds({ version: "160", releases: RELEASES, advisory: EXPLOITED });
  const asked = answerPrompts(0);
  await gZenSecurityWatch.check();

  ok(gZenSecurityWatch.blocking, "Web pages are held back");
  is(asked.length, 0, "The block screen asks, not a dialog");

  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  gBrowser.selectedTab = tab;
  await TestUtils.waitForCondition(
    () => BrowserTestUtils.isVisible(blockScreen()),
    "The block screen covers a tab that tried to load a page"
  );
  is(tab.linkedBrowser.currentURI.spec, "about:blank", "The page did not load");
  ok(
    blockScreen()
      .querySelector(".zen-security-block-list")
      .textContent.includes("CVE-2026-2002"),
    "It names the vulnerability"
  );

  const settings = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:preferences"
  );
  ok(
    BrowserTestUtils.isHidden(blockScreen()),
    "Built-in pages are not covered"
  );
  BrowserTestUtils.removeTab(settings);
  gBrowser.selectedTab = tab;
  ok(BrowserTestUtils.isVisible(blockScreen()), "The held tab still is");

  const loaded = BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PAGE);
  blockScreen().querySelector(".zen-security-block-continue").click();
  await loaded;
  ok(!gZenSecurityWatch.blocking, "Continuing lifts the block");
  ok(BrowserTestUtils.isHidden(blockScreen()), "The screen goes away");
  is(tab.linkedBrowser.currentURI.spec, PAGE, "The held page loads");

  await gZenSecurityWatch.check();
  ok(!gZenSecurityWatch.blocking, "It stays lifted for the session");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_bug_in_the_exploited_catalog_blocks_too() {
  await useFeeds({
    version: "160",
    releases: RELEASES,
    advisory: SERIOUS,
    knownExploited: ["CVE-2026-1001"],
    graceDays: 3,
  });
  answerPrompts(0);
  await gZenSecurityWatch.check();
  ok(gZenSecurityWatch.blocking, "Web pages are held back");
});

add_task(async function test_blocking_can_be_turned_off() {
  await useFeeds({ version: "160", releases: RELEASES, advisory: EXPLOITED });
  await SpecialPowers.pushPrefEnv({
    set: [["zen.security-watch.block-exploited", false]],
  });
  const asked = answerPrompts(0);
  await gZenSecurityWatch.check();
  await TestUtils.waitForCondition(() => asked.length == 1, "It asks instead");

  ok(!gZenSecurityWatch.blocking, "Nothing is blocked");
  await SpecialPowers.popPrefEnv();
});
