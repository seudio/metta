# Metta release notes

What changed in each build of Metta, newest first. Builds are named after the
Zen release they are based on. Downloads are on the
[releases page](https://github.com/seudio/metta/releases) and at
[seud.io/metta](https://seud.io/metta/).

Every release, and every new feature, gets an entry here. The same text goes in
the GitHub release and on [seud.io/metta/releases](https://seud.io/metta/releases/).

## Metta 1.25b

26 November 2026 · based on Zen 1.25b and Firefox 161.0

- **Security fixes from Firefox 161.** Mozilla's advisory for this release
  lists 110 fixes, more than half of them rated high. None is reported as being
  used in attacks. If Metta has been telling you a security fix is missing,
  this is the build that has it.
- **Links from other apps stay out of the way.** A link that opens in a Little
  Metta window no longer pulls your other Metta windows in front of the app
  you clicked it in. Little windows are also larger.
- **Import windows from Dia.** Zen's importer can now bring over open windows
  from the Dia browser.
- **Cmd+T opens an extension's new-tab page**, if you have an extension that
  provides one.
- **Cmd+1 to Cmd+9 skip Glance tabs**, so the shortcuts land on the tabs you
  see in the sidebar.
- **Session backups recover better** after a crash or a full disk.
- A space you have just created is no longer lost when you switch away from it
  with the sidebar on the right.
- The zoom notice shows only when you change zoom from the keyboard.
- Less work on tab, media and hover events, so the sidebar and space switching
  are lighter.
- Everything else new in Zen 1.25b.

## Metta 1.24.3b

20 November 2026 · based on Zen 1.24.3b and Firefox 160.0.1

- **Security fixes from Firefox 160.0.1.** The one that matters on a Mac is
  CVE-2026-130021, a memory error in audio and video playback rated high. It
  is not known to be used in attacks.
- **The security prompt tells you more.** When Metta is missing a security fix,
  the prompt now says whether a newer Metta with the fix is out, has only some
  of the fixes, or is still pending, and it offers a Get the Update button when
  there is one. If a fixed build comes out after you have dismissed the prompt,
  Metta tells you once.
- **The prompt says how risky browsing is.** It distinguishes fixes that nobody
  is known to be attacking, where care with unfamiliar sites is enough, from
  vulnerabilities being used in attacks now, where browsing is dangerous until
  you update.
- **Metta has its own pane in Settings.** Zen 1.24.3b replaces the settings page
  with a settings window. Auto Archive, Meetings and Security fixes moved from
  Tab Management to a new Metta pane in that window.
- **What's new opens Metta's release notes.** The page that opens the first
  time a new build starts, and the release notes links in the sidebar notice
  and the About window, now go to Metta's notes instead of Zen's.
- The green dot that Zen's test builds show under an Essential whose title
  starts with a count, such as "(1) Home / X", is off, as it is in released
  Zen. To turn it on, set `zen.theme.essentials-unread-dot` in `about:config`.
- While browsing is paused for an attacked vulnerability, the pages needed to
  download the newer build still load.
- Everything new in Zen 1.24.3b, including Little Zen windows, the settings
  window and copying the addresses of several selected tabs.

## Metta 1.24.2b

17 November 2026 · based on Zen 1.24.2b and Firefox 160.0

- **Security fix watch.** Metta does not update itself, so it checks Mozilla's
  security advisories a few times a day. A missing fix rated high or critical
  is asked about once. A missing fix for a vulnerability already used in
  attacks pauses web browsing until you approve.
- **Join button for meetings.** Add your calendars' private iCal addresses and a
  card with a Join button appears in the sidebar a few minutes before a video
  meeting.
- Auto Archive no longer double-counts overlapping sleep periods.
- Recurring meetings handle moved occurrences and weekday-only daily rules.
- The selected space is easier to see in the space selector.
- First build signed with a Developer ID certificate and notarized by Apple.

## Metta 1.24.1b

5 November 2026 · based on Zen 1.24.1b and Firefox 159.0.1

- First build. **Auto Archive**: tabs you have not used for a while are
  unloaded, then closed and kept in an archive in the Library. A tab opened
  from the archive returns to the space and container it came from.
