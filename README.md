# allsport

Daktronics **All Sport 5000 Series** control console emulator for **hockey**
(sport insert LL-2436, codes 4401 / 4402), as a web app.

Same shape as the `nevco` emulator: scoreboard on top, the console's control
display in the middle, the control keypad on the bottom.

- **Scoreboard** — the installed board, modelled from
  `docs/reference/scoreboard.jpeg`: shots on goal at the outside edges, a
  team-name message center above each score, the clock above the period at
  centre, and two player/penalty slots per team below. Amber digits
  throughout except the scores and penalty times, which are red. HOME is the
  left half. The board has no T.O.L. or saves windows, so those console
  values appear on the LCD only.
- **Control display** — the console's 2-line × 16-character green LCD, with the
  real prompt text from the manual (`MAIN CLOCK -SET`, `HOME PLYR/PEN`,
  `TIME OUTS-HOME`, …).
- **Keypad** — the LL-2436 hockey insert (HOME / game / GUEST key groups) plus
  the console's fixed standard keys: number pad, menu navigation diamond,
  EDIT, horn control and clock control. Geometry follows insert drawing
  DWG-124218 and Figure 3 of the manual. The tab on the left of the deck
  swaps the insert for the LL-2441 team-name keyboard, the way the physical
  insert slides in and out.

## Run in a browser

Static site, no build step and no CDN — open `index.html`, or serve the folder:

```
python -m http.server 8000
# then visit http://localhost:8000
```

In VS Code: **Run and Debug → “Emulator in Chrome”** (starts the `serve` task
first), or run the `serve` task on its own.

### Keyboard

| Key | Console equivalent |
| --- | --- |
| `Space` | START / STOP the main clock (the remote rocker switch) |
| `H` (hold) | HORN |
| `0`–`9` | number pad |
| `Enter` | ENTER / YES |
| `Esc` | CLEAR / NO |
| `Backspace` | delete a digit from the entry buffer |
| `↑ ↓ ← →` | menu navigation |
| `M` / `E` | MENU / EDIT |

During team name entry the keyboard types into the name instead: letters,
digits, space and `& ' , - .` all go in, `Shift`+letter selects the narrow
face, `Backspace` steps back a character, and `Esc` blanks the field (twice
to leave it unchanged).

## What's emulated

Team names, entered through MENU > ROSTER on the LL-2441 keyboard and drawn
as real lit pixels on the board's message centers — the WIDTH (16/32/48/64
columns), HEIGHT (7/8 rows) and FONT (single/double stroke) keys all change
what you see, and a name too long for the module is clipped exactly as the
board would clip it.

Main clock (count up/down, tenths under a minute, auto horn at period end),
period, score / shots on goal / saves for both teams, player penalties
(entry, edit, delete, clear all, MINOR/MAJOR default times, enable/disable
penalty clocks), time outs (full/partial per team, the time out clock and its
warning horn), the shot clock (SET / RECALL, sync with main, auto blank), the
Auto Horn Interval Timer, the EDIT key, and the MENU tree including EDIT
SETTINGS with the manual's factory defaults (p.84).

Settings persist to `localStorage`, and the game in progress is snapshotted so
the console's `PREV CODE nnnn / RESUME GAME?` power-up prompt works.

Not wired yet: the Display and Dimming submenus beyond brightness, radio
channel settings, and the lacrosse/handball-only keys from insert 0G-1084219.
Team abbreviations are stored but have nowhere to show on this board.

## Reference material

- `allsport500_manual.pdf` — the operation manual this is built from, kept
  locally and **not** committed (third-party PDF, 14.5 MB). Section 2 (Basic
  Operation, p.5), Section 9 (Hockey/Lacrosse/Handball, p.74–84), Appendix B
  (inserts), Appendix D (quick reference).
- `docs/CONSOLE_REFERENCE.md` — the key layout, LCD prompts and default
  settings pulled out of the manual, so the app can be checked against it
  without re-reading the PDF.
- `docs/reference/*.png` — pages rendered out of the manual: the console face,
  the LL-2436 hockey insert, the LCD close-up.

## Deploying

`.github/workflows/pages.yml` publishes the static files to GitHub Pages on
every push to `main` (enable Pages once under **Settings → Pages → Source:
GitHub Actions**). `.github/workflows/ci.yml` syntax-checks `app.js` and
verifies every id `app.js` looks up still exists in `index.html`.

A native desktop wrapper is not set up here; if one is wanted, the Tauri
scaffolding in the `nevco` project ports over directly.
