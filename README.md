# Technology Radar

An interactive technology radar hosted on GitHub Pages and shown on a SharePoint page. People propose technologies through a GitHub issue form; when a maintainer adds the `approved` label, a GitHub Action puts the blip on the radar automatically.

No packages, build step or server: the radar is one HTML file that reads a JSON data file.

## What's in here

| Path | What it is |
| --- | --- |
| `site/index.html` | The radar page: quadrants, rings, numbered blips, detail panel, search and list |
| `site/report.html` | The PDF report layout (also viewable in a browser as a page preview) |
| `site/radar-core.js` | Radar drawing code shared by both pages |
| `site/data/report.md` | The report's text sections: About, Contributors, Themes |
| `site/vendor/` | [Paged.js](https://pagedjs.org) (MIT licence), which lays the report out as pages |
| `scripts/build-pdf.mjs` | Turns the report into a PDF with headless Chrome during publishing |
| `site/config.json` | Title, quadrant names, positions and colours, ring names and descriptions, repo name |
| `site/data/blips.json` | The radar's content. Updated by the Action; you can also edit it by hand |
| `site/images/` | Banner images |
| `.github/ISSUE_TEMPLATE/propose.yml` | The "Propose a technology" form |
| `.github/workflows/add-blip.yml` | Turns an approved proposal into a blip, then publishes |
| `.github/workflows/deploy.yml` | Publishes `site/` to GitHub Pages |
| `.github/workflows/new-edition.yml` | Starts a new edition (resets New/Moved markers) |
| `scripts/radar.mjs` | The script the workflows run (Node 20 or later, no dependencies) |
| `notes/decisions.md` | The decision log: every approved change and its reason. Not published to the radar |

## Sample data

`site/data/blips.json` contains Revit plus ten sample technologies marked `"sample": true`. The radar ignores that marker; it is there so you can find and delete the samples before going live. The sample descriptions are placeholders, not an agreed position.

## Setup (about 15 minutes)

### 1. Create the repository

1. On GitHub, create a new repository, for example `tech-radar`.
   - **Visibility:** on GitHub Free, Pages only publishes from a **public** repository, so the repository, its issues and the decision log are public. GitHub Pro and Team can publish from a private repository, but the site itself is still public. Only GitHub Enterprise Cloud can restrict the site to your organisation.
2. **Add file → Upload files** and drag in the `site`, `scripts` and `notes` folders and `README.md`, then **Commit changes**.
3. The GitHub website won't upload folders whose names start with a dot, so create these files one at a time with **Add file → Create new file**. Type the path exactly as shown (each `/` creates a folder), paste in the file's contents from this download and commit:
   - `.github/ISSUE_TEMPLATE/propose.yml`
   - `.github/workflows/add-blip.yml`
   - `.github/workflows/deploy.yml`
   - `.github/workflows/new-edition.yml`
   - `.gitignore` (optional; one line that stops a locally built PDF being committed)

   The `.github` folder is hidden by default on macOS (press Cmd+Shift+. in Finder to show it) and may be hidden on Windows (View → Show → Hidden items).

### 2. Point the config at your repository

Edit `site/config.json`:

- `repo`: your `owner/repository`, for example `contoso/tech-radar`. This powers the **Propose a technology** button and the issue links in blip history.
- `siteUrl`: the Pages address, usually `https://<owner>.github.io/<repository>/`.
- `logo`: path to your logo, for example `images/logo.png`. Upload the file to `site/images/` first. It shows top left on the radar and on the PDF cover. Set it to `""` for no logo. SVG or PNG with a transparent background works best; it is shown 36 px high.
- `logoLink` (optional): where clicking the logo goes, for example your intranet home page.
- `report.showRetired` (default `true`): include the *Retired this edition* page in the PDF.
- `coverLogo` (optional): a separate logo for the PDF cover, which is a solid `primary` colour with the logo top right. Use a white version of your logo here, for example `images/logo-white.svg`. Without it, the cover uses `logo`.
- `title`, `organisation`, quadrant `color`s and ring `description`s as you like.

### 3. Turn on Pages and Actions

1. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
2. **Settings → Actions → General:** make sure Actions are allowed. If a workflow later fails with a permissions error, set **Workflow permissions** to **Read and write permissions**.

### 4. Create the two labels

**Issues → Labels → New label**, twice:

- `proposal`: added automatically to every new proposal
- `approved`: you add this to publish a proposal

### 5. Publish for the first time

**Actions → Deploy radar to GitHub Pages → Run workflow.** After a minute the radar is live at your `siteUrl`.

### 6. Put it on your SharePoint page

1. Edit the SharePoint page and add an **Embed** web part.
2. Paste this, with your address:

   ```html
   <iframe src="https://<owner>.github.io/<repository>/" width="100%" height="1150" style="border:0"></iframe>
   ```

3. If SharePoint says **"Embedding content from this website isn't allowed"**, a site owner needs to go to **Settings → Site information → View all site settings → HTML Field Security** and add `github.io` to the allowed domains. This is a site setting, not a tenant admin setting.

Tip: add `#<blip-slug>` to the address to open the page with a blip already selected, for example `.../tech-radar/#agentsview`.

## Day-to-day use

### Proposing a technology

Anyone with access to the repository clicks **Propose a technology** on the radar (or **New issue** on GitHub) and fills in the form: name, quadrant, ring, description, related blips, Viva Engage link and banner image.

### Approving it

1. Review the issue and discuss it in the comments if needed. The proposer can edit the issue to make changes.
2. Add the `approved` label.
3. Within a couple of minutes, the Action adds the blip, comments on the issue with a link to it, closes the issue and republishes the radar.

If something is wrong (for example an empty description), the Action comments with what to fix and removes the `approved` label. Once the issue has been edited, add the label again.

Only people with at least Triage access to the repository can add labels, so only they can publish.

### Changing or moving an existing blip

Submit a new proposal with the **same name**. The new quadrant, ring and description replace the current ones; empty optional fields (related blips, Viva Engage link, banner) keep their current values. If the ring changes, the blip is marked **Moved**, and the change is recorded in its history.

### The decision log

The proposal form has an optional **Reason for this change** box. When a proposal is approved, the automation adds an entry to `notes/decisions.md`: the date, the blip, what changed (added, moved from one ring to another, updated), a link to the proposal and the reason. The newest entry comes first, and new editions are logged too.

The log lives outside `site/`, so it never appears on the radar or in the PDF. It is still **public** if the repository is public, so write reasons as you would for a colleague in another team. You can edit the file by hand at any time, for example to add a reason after the fact.

### Retiring a blip, and bringing it back

Nothing is ever retired automatically; it only happens when you approve a proposal.

**To retire:** open a proposal, choose **Retire** under *What should happen?*, enter the blip's exact name and a reason, and add `approved`. The automation:

- takes the blip off the radar, the quadrant pages and the PDF;
- keeps everything about it (description, banner, links, history) and lists it on the **Archive** tab with the date and reason;
- adds "Retired from <ring>" to its history and an entry to the decision log;
- hides it from other blips' related tiles on the radar and in the PDF. The Archive still shows those links, and they reappear automatically if the blip returns.

Links to a retired blip, such as an old `#jenkins` link, open its Archive entry.

**To bring it back:** open an ordinary **Add or update** proposal with the same name, choose its quadrant and ring, and approve it. The blip returns with its history intact ("Returned to Trial") and shows as **New** in that edition. Fields you leave empty keep their previous values.

**In the PDF:** blips retired in the current edition are listed at the end of the report under *Retired this edition*, with the reason. To leave this page out, set `"report": { "showRetired": false }` in `config.json`. Blips retired in earlier editions only appear on the Archive tab.

### Starting a new edition

When you publish a new edition of the radar, run **Actions → Start a new radar edition → Run workflow** and give it a name such as "May 2027". Every blip goes back to "No change", so only the next round of proposals shows as New or Moved.

### The PDF report

Every time the radar is published, GitHub also builds a PDF report, `technology-radar.pdf`, and **Download PDF** opens it. The report contains:

1. Cover with your logo, title and edition
2. Contents with page numbers
3. About the radar *(from `report.md`)*
4. Radar at a glance: quadrants, ring meanings and markers *(generated)*
5. Any other sections in `report.md`, in order, such as Contributors and Themes
6. The full radar
7. One section per quadrant: a zoomed-in radar, a numbered index by ring, then each blip's write-up with its banner, description, related blips and Viva Engage link

Every page after the cover has a footer with the copyright line, section name and page number. The copyright line is `© <year> <organisation>`; set `"copyright"` in `config.json` to change it.

#### Editing the report text

Edit `site/data/report.md` on GitHub. Each line starting with `# ` begins a section:

```markdown
# About the radar
Paragraphs about why you publish the radar.

# Contributors
- Jane Smith, Head of Engineering
- Raj Patel, Principal Engineer

# Themes
## First theme
A few paragraphs.

## Second theme
More paragraphs.
```

- A section called **About…** goes first; the others follow "Radar at a glance" in the order they appear.
- Delete a section, or leave it empty, and it's left out of the report.
- Contributors listed with `- ` are laid out in three columns.
- Inside a section, `## ` makes a sub-heading. **Bold**, bullet lists and [links](https://example.com) work.

To preview the report before publishing, serve the site locally (see below) and open `/report.html`: it shows the pages as they will print.

### Editing by hand

You can edit `site/data/blips.json` directly on GitHub; the radar republishes when you commit. Removing a blip means deleting its entry. Each blip looks like this:

```json
{
  "name": "AgentsView",
  "slug": "agentsview",
  "quadrant": "Tools",
  "ring": "Assess",
  "status": "New",
  "previousRing": "Trial",
  "description": "Markdown text. **Bold**, bullet lists and [links](https://example.com) work.",
  "related": ["Claude Code", "Context profiling"],
  "engage": "https://engage.cloud.microsoft/...",
  "banner": "images/agentsview.png",
  "history": [{ "date": "2026-11-11", "ring": "Assess", "change": "Added", "issue": 42 }]
}
```

`status` is `New`, `Moved` or `No change`. `previousRing` only matters when the status is `Moved`; it decides whether the marker shows "moved in" or "moved out".

## Quadrant pages

Each quadrant has its own page at `?q=<quadrant>`, for example `.../mm-tech-radar/?q=design`. It shows the quadrant zoomed in, with its blips grouped by ring; each blip expands to show its banner, description, links and history. People get there from the tabs under the header, by clicking a quadrant name on the radar, or from the quadrant headings in the list. Add `#<blip-slug>` to open a blip straight away, for example `?q=design#revit`.

The short text under each quadrant's title comes from that quadrant's `description` in `config.json`; it also appears in the PDF report.

To show a single quadrant on a SharePoint page, use the quadrant page's address in the Embed web part, for example `?q=design` or `?q=commissioning-handover`.

## How the radar draws blips

- The quadrant decides which quarter of the circle a blip goes in, and the ring decides its distance from the centre.
- Within that band, the position is derived from the blip's name, so a blip stays put between visits. Overlapping blips are pushed apart.
- Blips are numbered in the order of the quadrants in `config.json`, then by ring, then alphabetically.
- New blips get an outer ring. Moved blips get an arc on the side they moved from.

## Colours and branding

All colours come from `site/config.json`, so the radar page, quadrant pages and PDF stay consistent:

```json
"theme": {
  "primary": "#16384c",
  "highlight": "#16384c",
  "ink": "#1d2433",
  "muted": "#5b6475",
  "panel": "#eef1f5"
}
```

- `primary`: header bars, buttons, the PDF cover and sub-headings. Text on it automatically switches between black and white for contrast.
- `highlight`: the rule under section titles in the PDF and the lines on the cover.
- `ink` / `muted`: main text and secondary text.
- `panel`: the background behind the radar quadrants.
- Each quadrant's `color` sets its blips and accents. Numbers on light colours (such as yellow) switch to black automatically.

### Mott MacDonald example

Using the Mott MacDonald Visual Identity Toolkit (Sep 2024): secondary colours on the quadrants, MM Purple as `primary` and MM Turquoise as `highlight`. Replace the two `REPLACE` values with the exact hex codes from the internal toolkit.

```json
"theme": { "primary": "#REPLACE-MM-PURPLE", "highlight": "#REPLACE-MM-TURQUOISE", "ink": "#000000", "muted": "#5E5E5E", "panel": "#EBEBEB" }
```

Quadrant colours: Enabling `#0097FF` (MM Blue), Design `#9AD248` (MM Green), Construction `#FF6707` (MM Orange), Commissioning & Handover `#FFD41C` (MM Yellow). Use the official black or white logo, top left, as the brand manual asks.

## Changing quadrants or rings

Change them in **both** `site/config.json` and the dropdowns in `.github/ISSUE_TEMPLATE/propose.yml`. The radar supports exactly four quadrants (positions `top-left`, `top-right`, `bottom-left`, `bottom-right`) and four rings.

## Banner images

Submitters can drag an image into the **Banner image** box or paste a link. The Action copies the image into `site/images/` so it keeps working.

In a private repository, images dragged into issues are private attachments. If the Action can't download one, it says so on the issue and links to the original address, which won't display for people outside GitHub. In that case, upload the image to `site/images/` yourself and set `banner` in `blips.json`. Wide images (about 3:1) look best; without a banner, the panel shows a coloured header for the quadrant.

## Previewing locally

The page loads its data with `fetch`, so it needs to be served rather than opened as a file:

```bash
cd site
python -m http.server 8000
# open http://localhost:8000
```

To test the script against a saved issue event: `GITHUB_EVENT_PATH=event.json node scripts/radar.mjs add-from-issue`.
