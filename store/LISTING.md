# Chrome Web Store submission kit

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). If the name changes, update `lib/brand.ts`, run `pnpm build && pnpm store-assets && pnpm zip`, and replace the name in this file.

## Before you submit

1. **Decide about Substack's Terms.** Substack's [Terms of Use](https://substack.com/tos) prohibit scraping. Store approval doesn't settle whether this extension is allowed. Ask Substack or get advice first, or start with **Unlisted** visibility.
2. **Register** at the dashboard and pay the one-time fee. Use an email address you'll keep; it can't be changed later.
3. **Turn on 2-Step Verification** for that Google account.
4. **Build the package:** `pnpm install && pnpm zip` produces `dist/substack-organizer-<version>-chrome.zip`. Upload that file.

## Package

Upload `dist/substack-organizer-0.1.0-chrome.zip`.

## Store listing tab

**Name** comes from the manifest: Subscription Organizer for Substack

**Summary** (from the manifest, 132 characters max):

> Sort your Substack subscriptions into folders and pin the ones you read most.

**Description:**

```
Have too many Substack subscriptions to keep track of? Sort them into folders and pin the ones you read most, so the writers you care about are always at the top.

Click the toolbar icon to open your reading room:

• Pinned: the latest posts from the publications you've pinned, newest first.
• Folders: group publications however you like ("Morning read", "Food", "Work"). Each folder shows its publications' latest posts. A publication can be in as many folders as you want.
• Unsorted: new subscriptions land here until you file them.
• All subscriptions: everything you subscribe to, with a filter box.

File publications by dragging them onto a folder, or with the Folders button. Drag folders to reorder them. Export your folders to a file as a backup, and import them on another computer.

Private by design
• Runs entirely in your browser. There are no servers, accounts, analytics or ads.
• Uses your existing Substack login in Chrome. It never reads or stores your password or cookies.
• Folders and pins sync to your other computers through Chrome Sync, if you have it on.
• Clear the cached Substack data at any time from the sidebar.

Posts open on Substack, so paid posts work exactly as they do on the site.

Known limits
• Recent posts come from each publication author's Substack profile. A few publications whose author posts elsewhere may show no posts.
• The combined "Latest posts" view is available for groups of up to 60 publications.

This is an independent, open-source project. It is not affiliated with or endorsed by Substack. Source code: https://github.com/joshshifman/substack-organizer
```

**Category:** Productivity (pick the closest subcategory the dashboard offers, such as Workflow & Planning)

**Language:** English

**Images** (all in `store/`):

| Field | File |
| --- | --- |
| Store icon (128×128) | `public/icon/128.png` |
| Screenshots (1280×800) | `screenshot-1-pinned.png`, `screenshot-2-folder.png`, `screenshot-3-organize.png`, `screenshot-4-privacy.png` |
| Small promo tile (440×280) | `promo-small.png` |
| Marquee promo tile (1400×560, optional) | `promo-marquee.png` |

The screenshots show invented publications, not real Substack data.

**Official URL:** leave blank (it's for a website you've verified you own). **Homepage URL:** https://github.com/joshshifman/substack-organizer

**Support URL:** https://github.com/joshshifman/substack-organizer/issues

## Privacy practices tab

**Single purpose:**

```
Lets the user organize their own Substack subscriptions into folders and pins, and view recent posts from the publications they've organized.
```

**Permission justifications:**

`storage`:

```
Saves the user's folders and pinned publications (chrome.storage.sync, so they follow the user across their Chrome installs) and caches their subscription list and recent posts locally (chrome.storage.local) so the page opens quickly. No data leaves the browser.
```

Host permission `https://substack.com/*`:

```
Reads the signed-in user's own subscription list (/api/v1/user/profile/self) and recent posts from those publications (/api/v1/profile/posts) from substack.com, using the user's existing Substack session. This is the only site the extension contacts. It does not inject scripts into or modify any web page.
```

**Remote code:** No, I am not using remote code.

```
All JavaScript is bundled in the package. The extension fetches JSON data and images from Substack but never executes remote code.
```

**Data usage.** Tick the data types the extension handles:

- [x] **Website content.** Post titles, subtitles, images and links from Substack, plus the subscription list.
- [ ] **Personally identifiable information.** Chrome defines this as name, address, email, age or ID numbers, which the extension doesn't read. It's a judgement call: ticking it is harmless if you'd rather over-disclose, since the subscription list includes private subscriptions.
- [ ] Health information
- [ ] Financial and payment information. It only sees whether a subscription is paid, not payment details. Leave unticked.
- [ ] Authentication information. The browser attaches Substack cookies; the extension never reads them.
- [ ] Personal communications
- [ ] Location
- [ ] Web history
- [ ] User activity

Tick all three certifications:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/joshshifman/substack-organizer/blob/main/PRIVACY.md

## Distribution tab

- **Payments:** Free, no in-app purchases.
- **Visibility:** Unlisted to start (anyone with the link can install; it doesn't appear in search). You can switch to Public later.
- **Regions:** All regions.

## Test instructions (for reviewers)

```
The extension needs a Substack account with at least a few subscriptions. Any free Substack account works: sign up at substack.com and subscribe to two or three free publications.

1. Sign in to substack.com in Chrome.
2. Click the extension's toolbar icon. A tab opens with a notice explaining what the extension reads and stores. Click Continue.
3. Click "All subscriptions", then "Publications". Your subscriptions are listed.
4. Click the pin icon on a publication, then click "Pinned" in the sidebar to see its latest posts.
5. Click "+" next to Folders, name a folder, then drag a publication onto it (or use its "Folders" button). Click the folder to see its posts.
6. "Clear cache" in the sidebar deletes cached Substack data; folders are kept.

No credentials are needed beyond the reviewer's own Substack account.
```
