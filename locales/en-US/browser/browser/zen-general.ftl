# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

zen-panel-ui-current-profile-text = current profile

unified-extensions-description = Extensions are used to bring more extra functionality into { -brand-short-name }.
tab-context-zen-reset-pinned-tab =
    .label =
        { $isEssential ->
            [true] Reset Essential Tab
           *[false] Reset Pinned Tab
        }
    .accesskey = R
tab-context-zen-add-essential =
    .label = Add to Essentials
    .accesskey = E
tab-context-zen-add-essential-badge = { $num } / { $max }
tab-context-zen-remove-essential =
    .label = Remove from Essentials
    .accesskey = R
tab-context-zen-edit-pinned-page =
    .label =
        { $isEssential ->
            [true] Edit Essential URL
           *[false] Edit Pinned URL
        }
    .accesskey = P
tab-context-zen-replace-pinned-url-with-current =
    .label = Replace with Current URL
    .accesskey = C
tab-context-zen-edit-pinned-url =
    .label = Edit…
    .accesskey = E
tab-context-zen-edit-title =
    .label = Change Label…
tab-context-zen-edit-icon =
    .label = Change Icon…

zen-themes-corrupted = Your { -brand-short-name } mods file is corrupted. They have been reset to the default theme.

# note: Do not translate the "<br/>" tags in the following string
zen-new-urlbar-notification = The new URL bar has been enabled, removing the need for new tab pages.<br/><br/>
    Try opening a new tab to see the new URL bar in action!

zen-disable = Disable

pictureinpicture-minimize-btn =
  .aria-label = Minimize
  .tooltip = Minimize

zen-panel-ui-gradient-generator-custom-color = Custom Color

zen-copy-urls-confirmation =
    { $count ->
        [1] Copied current URL!
       *[other] Copied { $count } URLs!
    }
zen-copy-urls-as-markdown-confirmation =
    { $count ->
        [1] Copied current URL as Markdown!
       *[other] Copied { $count } URLs as Markdown!
    }

zen-general-cancel-label =
    .label = Cancel
zen-general-confirm =
    .label = Confirm

zen-pinned-tab-replaced = Pinned tab URL has been replaced with the current URL!
zen-pinned-tab-url-edited = Pinned tab URL has been updated!
zen-pinned-tab-url-invalid = That doesn't look like a valid URL.
zen-pinned-tab-edit-url-title = Edit Pinned URL
zen-pinned-tab-edit-url-label = Enter the URL this pinned tab should point to:
zen-tabs-renamed = Tab has been successfully renamed!
zen-background-tab-opened-toast = New background tab opened!
zen-zoom-changed-toast = { NUMBER($percentage, style: "percent") }
zen-workspace-renamed-toast = Workspace has been successfully renamed!
zen-split-view-limit-toast = Can't add more panels to the split view!
zen-shortcut-blocked-toast = <span>{ $shortcut }</span> again to { $action }
zen-shortcut-blocked-toast-default-action = use it in { -brand-short-name }
zen-sidebar-drag-collapsed-toast = Sidebar hidden! Use <span>{ $shortcut }</span> to bring the sidebar back.

zen-toggle-compact-mode-button =
    .label = Compact Mode
    .tooltiptext = Toggle Compact Mode

# note: Do not translate the "<br/>" tags in the following string

zen-learn-more-text = Learn More

zen-close-label = Close

zen-singletoolbar-urlbar-placeholder-with-name =
  .placeholder = Search...

zen-icons-picker-emoji =
  .label = Emojis
zen-icons-picker-svg =
  .label = Icons
zen-emojis-picker-search =
  .placeholder = Search emojis

urlbar-search-mode-zen_actions = Actions
zen-site-data-settings = Settings

zen-generic-manage = Manage
zen-generic-more = More
zen-generic-next = Next

zen-essentials-promo-label = Add to Essentials
zen-essentials-promo-sublabel = Keep your favorite tabs just a click away

# These labels will be used for the site data panel settings
zen-site-data-setting-allow = Allowed
zen-site-data-setting-block = Blocked
zen-site-data-protections-enabled = Enabled
zen-site-data-protections-disabled = Disabled
zen-site-data-security-info-extension =
    .label = Extension
zen-site-data-security-info-secure =
    .label = Secure
zen-site-data-security-info-not-secure =
    .label = Not Secure

zen-site-data-manage-addons =
    .label = Manage Extensions
zen-site-data-get-addons =
    .label = Add Extensions
zen-site-data-site-settings =
    .label = All Site Settings


zen-site-data-header-share =
    .tooltiptext = Share This Page
zen-site-data-header-boost =
    .tooltiptext = Create a Boost
zen-site-data-header-reader-mode =
    .tooltiptext = Enter Reader Mode
zen-site-data-header-screenshot =
    .tooltiptext = Take a Screenshot
zen-site-data-header-bookmark =
    .tooltiptext = Bookmark This Page

zen-urlbar-copy-url-button =
  .tooltiptext = Copy URL

zen-site-data-setting-site-protection = Tracking Protection

# Section: Feature callouts

zen-site-data-panel-feature-callout-title = A new home for add-ons, permissions, and more
zen-site-data-panel-feature-callout-subtitle = Click the icon to manage site settings, view security info, access extensions, and perform common actions.

zen-open-link-in-glance =
    .label = Open Link in Glance
    .accesskey = G

zen-sidebar-notification-updated-heading = Update Complete!

# See ZenSidebarNotification.mjs to see how these would be used

zen-sidebar-notification-updated-label = What's new in { -brand-short-name }
zen-sidebar-notification-updated-tooltip =
    .title = View Release Notes
zen-sidebar-notification-donate-label = Support { -brand-short-name }
zen-sidebar-notification-donate-tooltip =
    .title = Donate to the project
zen-sidebar-notification-restart-safe-mode-label = Something broke?
zen-sidebar-notification-restart-safe-mode-tooltip =
    .title = Restart in Safe Mode

zen-window-sync-migration-dialog-title = Keep Your Windows in Sync
zen-window-sync-migration-dialog-message = Zen now syncs windows on the same device, so changes in one window are reflected across the others instantly.
zen-window-sync-migration-dialog-learn-more = Learn More
zen-window-sync-migration-dialog-accept = Got It

zen-appmenu-new-blank-window =
    .label = New Blank Window
zen-appmenu-new-little-window =
    .label = New Little Window

zen-little-window-open-in-space = Open in <b data-l10n-name="space">{ $space }</b>
zen-little-window-open-in-new-window = Open in { -brand-short-name }
zen-little-window-choose-space =
    .tooltiptext = Choose a Space
zen-little-window-title = Little Zen
zen-little-window-intro-title = Opened in <i data-l10n-name="name">Little Zen</i>
zen-little-window-intro-description = Click “Open in” to move this page to a full window, or { $shortcut } to close
zen-little-window-download-source =
    .value = From { $host }


zen-security-block-title = Browsing is paused
# $current (String) - The Firefox version this build is based on
# $latest (String) - The newest Firefox version with security fixes
zen-security-block-summary = This build is based on Firefox { $current }. Firefox { $latest } fixes a vulnerability that is already being used in attacks, and this build does not have the fix yet.
zen-security-block-advice = Browsing is dangerous until this is fixed: a web page could use the vulnerability just by being opened. Web pages stay closed until you update, or choose to continue without the fix. Settings and other built-in pages still work.
zen-security-block-update =
    .label = Get the Update
zen-security-block-continue =
    .label = Continue for This Session
zen-security-prompt-title = Security fixes are missing
# $current (String) - The Firefox version this build is based on
# $latest (String) - The newest Firefox version with security fixes
zen-security-prompt-intro = This build is based on Firefox { $current }. Firefox { $latest } is out, and fixes vulnerabilities that this build still has:
# $version (String) - The Firefox version with the fixes
# $level (String) - How serious the worst of them is: high or critical
# $count (Number) - How many of the fixes are rated high or critical
zen-security-prompt-item =
    { $count ->
        [0] Firefox { $version }: rated { $level }
        [one] Firefox { $version }: 1 fix rated { $level }
       *[other] Firefox { $version }: { $count } fixes rated high or critical
    }
zen-security-prompt-risk = None of them is known to be used in attacks, so browsing is not dangerous yet. The risk grows the longer a fix has been public: until you update, be careful with links and sites you do not know.
zen-security-prompt-risk-exploited = At least one of them is being used in attacks now. Browsing is dangerous until you update: a web page could use it just by being opened. Keep to sites you trust.
zen-security-prompt-update = Get the Update
# $metta (String) - The version of the newest build of this browser
# $firefox (String) - The Firefox version that build is based on
zen-security-release-available = { -brand-short-name } { $metta } is out and has these fixes.
zen-security-release-partial = { -brand-short-name } { $metta } is out. It is based on Firefox { $firefox }, so it has some of these fixes but not all.
zen-security-release-pending = There is no { -brand-short-name } build with these fixes yet. One is pending, and you will be told when it is out.
zen-security-release-unknown = Whether a newer { -brand-short-name } build is out could not be checked.
zen-security-prompt-continue = Continue
zen-security-prompt-later = Remind Me Tomorrow

zen-meeting-join =
    .label = Join
zen-meeting-dismiss =
    .tooltiptext = Hide
zen-meeting-untitled =
    .value = Meeting
zen-meeting-starting-now =
    .value = Starting now
# $minutes (Number) - Minutes until the meeting starts
zen-meeting-starts-in =
    .value = In { $minutes } min
# $minutes (Number) - Minutes since the meeting started
zen-meeting-started-ago =
    .value = Started { $minutes } min ago
