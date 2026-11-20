# Metta release notes

What changed in each build of Metta, newest first. Builds are named after the
Zen release they are based on. Downloads are on the
[releases page](https://github.com/seudio/metta/releases) and at
[seud.io/metta](https://seud.io/metta/).

Every release, and every new feature, gets an entry here. The same text goes in
the GitHub release and on [seud.io/metta/releases](https://seud.io/metta/releases/).

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
