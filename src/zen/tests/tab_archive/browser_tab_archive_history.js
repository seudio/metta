/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_archived_tabs_are_only_in_the_archive() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.library.history.closed-tabs", true]],
  });
  const archivedUrl = "https://example.com/?only-in-archive";
  const closedUrl = "https://example.com/?closed-normally";

  const closedTab = await openIdleTab(closedUrl);
  BrowserTestUtils.removeTab(closedTab);
  const archivedTab = await openIdleTab(archivedUrl);
  const closed = BrowserTestUtils.waitForTabClosing(archivedTab);
  await gZenTabArchive.archiveNow();
  await closed;

  const Library = customElements.get("zen-library");
  Library.toggle("history");
  let section;
  await TestUtils.waitForCondition(() => {
    section = document.querySelector("zen-library-history-section");
    return section?.querySelector(".zen-library-row");
  }, "the closed tabs are listed");
  const urls = [...section.querySelectorAll(".zen-library-visit-url")].map(
    el => el.textContent
  );
  ok(
    urls.some(text => text.includes("closed-normally")),
    "a tab closed by hand is under Closed tabs"
  );
  ok(
    !urls.some(text => text.includes("only-in-archive")),
    "an archived tab is not"
  );

  Library.toggle("archive");
  let archiveSection;
  await TestUtils.waitForCondition(() => {
    archiveSection = document.querySelector("zen-library-archive-section");
    return archiveSection?.querySelector(".zen-library-row");
  }, "the archive lists its tabs");
  ok(
    archiveSection.textContent.includes("only-in-archive"),
    "the archived tab is in the archive"
  );

  Library.toggle("archive");
  await TestUtils.waitForCondition(
    () => !Library.isLibraryOpen && Library.libraryProgress === 0,
    "library closes"
  );
  await clearArchive();
  await SpecialPowers.popPrefEnv();
});
