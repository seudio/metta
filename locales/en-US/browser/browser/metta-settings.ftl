# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## The Metta pane of the settings window

metta-settings-pane = Metta

metta-settings-archive-header = Auto Archive
metta-settings-archive-threshold = Archive tabs after
metta-settings-archive-description = Tabs you have not used for this long are unloaded, then moved to the Archive in the Library one period later. Pinned tabs, Essentials, and tabs playing media or with unsaved changes are never archived.
metta-settings-archive-threshold-12-hours =
    .label = 12 hours
metta-settings-archive-threshold-24-hours =
    .label = 24 hours
metta-settings-archive-threshold-7-days =
    .label = 7 days
metta-settings-archive-threshold-30-days =
    .label = 30 days
metta-settings-archive-threshold-never =
    .label = Never
metta-settings-archive-now = Archive inactive tabs now
metta-settings-archive-now-button = Archive Now
# $count (Number) - Tabs that were just archived
metta-settings-archive-now-done =
    { $count ->
        [one] Archived 1 tab
       *[other] Archived { $count } tabs
    }
metta-settings-archive-write-failed = Auto Archive is paused because the archive could not be saved. Archive inactive tabs now to try again.

metta-settings-meetings-header = Meetings
metta-settings-meetings-calendars = Calendar addresses, one per line
metta-settings-meetings-description = A few minutes before a meeting with a Zoom, Google Meet, Teams or Webex link, a Join button appears in the sidebar. Add the private address of each calendar to watch: in Google Calendar it is under Settings, your calendar, “Secret address in iCal format”; in Outlook, publish the calendar and copy its ICS link.
metta-settings-meetings-calendars-input =
    .placeholder = https://calendar.google.com/calendar/ical/…/basic.ics
# $count (Number) - Meetings with a video link left today
metta-settings-meetings-status =
    { $count ->
        [0] No more meetings with a video link today
        [one] 1 more meeting with a video link today
       *[other] { $count } more meetings with a video link today
    }
# $failed (Number) - Calendars that could not be loaded
metta-settings-meetings-status-failed =
    { $failed ->
        [one] 1 calendar could not be loaded. Check its address.
       *[other] { $failed } calendars could not be loaded. Check their addresses.
    }
metta-settings-meetings-lead = Show the Join button
metta-settings-meetings-lead-1 =
    .label = 1 minute before
metta-settings-meetings-lead-5 =
    .label = 5 minutes before
metta-settings-meetings-lead-10 =
    .label = 10 minutes before

metta-settings-security-header = Security fixes
metta-settings-security-enabled = Check for missing security fixes
metta-settings-security-description = { -brand-short-name } does not update itself. A few times a day it checks Mozilla’s security advisories for fixes that newer Firefox releases have and it lacks, and asks before you carry on without a serious one.
metta-settings-security-block-exploited = Pause browsing while a fix for a vulnerability used in attacks is missing
metta-settings-security-check-now = Check Now
metta-settings-security-status-unchecked = Not checked yet
metta-settings-security-status-failed = The last check could not reach the advisories
# $current (String) - The Firefox version this build is based on
# $time (Date) - When the last check ran
metta-settings-security-status-current = No fixes missing for Firefox { $current } · checked { DATETIME($time, dateStyle: "medium", timeStyle: "short") }
# $current (String) - The Firefox version this build is based on
# $latest (String) - The newest Firefox version with security fixes
# $time (Date) - When the last check ran
metta-settings-security-status-behind = Based on Firefox { $current }; fixes in Firefox { $latest } are missing · checked { DATETIME($time, dateStyle: "medium", timeStyle: "short") }
metta-settings-security-status-exploited = Based on Firefox { $current }; Firefox { $latest } fixes a vulnerability used in attacks · checked { DATETIME($time, dateStyle: "medium", timeStyle: "short") }
# $metta (String) - The version of the newest build of this browser
# $firefox (String) - The Firefox version that build is based on
metta-settings-security-update-available = { -brand-short-name } { $metta } has these fixes
metta-settings-security-update-partial = { -brand-short-name } { $metta }, based on Firefox { $firefox }, has some of these fixes
metta-settings-security-update-button = Get the Update
