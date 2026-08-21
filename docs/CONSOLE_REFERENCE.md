# All Sport 5000 — hockey console reference

Extracted from `allsport500_manual.pdf` so the emulator can be checked without
re-reading the PDF. Page numbers are the manual's printed numbers; the PDF is
offset by +10 (printed p.74 = PDF page 84).

## The installed scoreboard

From `docs/reference/scoreboard.jpeg`. Blue face, white perimeter trim,
Daktronics mark over the clock window. HOME is the **left** half.

```
 SHOTS          [logo]    ┌──────────┐   [logo]         SHOTS
 ON GOAL                  │  _8:33   │                ON GOAL
                          └──────────┘
 ┌──────┐   ┌────────┐      PERIOD    ┌────────┐   ┌──────┐
 │ SOG  │   │ TEAM   │       ┌─┐      │ TEAM   │   │ SOG  │
 │  2d  │   │ SCORE  │       │1│      │ SCORE  │   │  2d  │
 └──────┘   └────────┘       └─┘      └────────┘   └──────┘
   PLAYER      PENALTY            PLAYER      PENALTY
 ┌──────┐  ┌──────────┐      ┌──────┐  ┌──────────┐
 │  2d  │  │  M:SS    │      │  2d  │  │   M:SS   │
 ├──────┤  ├──────────┤      ├──────┤  ├──────────┤
 │  2d  │  │  M:SS    │      │  2d  │  │   M:SS   │
 └──────┘  └──────────┘      └──────┘  └──────────┘
```

| Window | Digits | Colour | Notes |
|---|---|---|---|
| Clock | 4 (`MM:SS`) | amber | Leading zero blanked; drops to `SS.T` under a minute |
| Team score | 2 | **red** | Caps at 99 |
| Shots on goal | 2 | amber | Built into this board — no separate SOG console |
| Period | 1 | amber | Cycles 0–9 |
| Team name | dot matrix | amber | Message center above each score; programmed with the LL-2441 insert |
| Player number | 2 | amber | Two slots per team |
| Penalty time | 3 (`M:SS`) | **red** | Colon after the first digit, so 9:59 is the maximum |

Penalty ordering is mirrored: on the home half the player window is outboard
and the penalty inboard; on the guest half it is the other way round.

Not on this board — the console tracks them, but they have nowhere to show:
**saves**, **time outs left**, penalty indicator lamps, goal lights, and any
shot-clock display. There are no other units in the installation.

## Console face (Figure 3, p.5)

```
+--------------------------------------------------------------+
| SCAN FOR...        [ 2-line x 16-char LCD ]     ALL SPORT    |
|                                                 5000 SERIES  |
+--------------------------------------------------------------+
| sport insert (LL-2436)      | number | menu nav | horn ctrl   |
|                             | keypad |          |-------------|
|                             |        |          | clock ctrl  |
+--------------------------------------------------------------+
```

The LCD is 2 lines × 16 characters, green backlit, black characters. In game
mode the top line carries the main clock plus the count-direction arrow (and a
lowercase `i` when the interval timer is armed); the bottom line carries the
`H=` / `G=` scores. Penalty-clock state shows as `EN` / `DS` in the bottom
right corner (Quick Reference, p.228).

## Sport insert LL-2436 (DWG-124218, PDF p.201)

Three groups of 3 columns × 4 rows. Blank cells are blank on the real insert.

**HOME** (mirrored for **GUEST**, with `►` instead of `◄`)

| | col 1 | col 2 | col 3 |
|---|---|---|---|
| 1 | SCORE +1 | SCORE -1 | TIME OUT ◄ |
| 2 | SHOTS ON GOAL +1 | SHOTS ON GOAL -1 | |
| 3 | SAVES +1 | SAVES -1 | PENALTY ◄ |
| 4 | PLAYER PENALTY • | DELETE PENALTY • | CLEAR ALL PENALTIES • |

**Game keys** (centre group)

| | col 1 | col 2 | col 3 |
|---|---|---|---|
| 1 | RECALL SHOT TIME | SET SHOT TIME | TIME OUT ON / OFF |
| 2 | | ENABLE PENALTY CLOCKS | DISABLE PENALTY CLOCKS |
| 3 | | MINOR PENALTY | MAJOR PENALTY |
| 4 | | | PERIOD +1 |

A `•` on a key means it needs follow-up entry (a number, then `ENTER`).

Codes on the insert: 4000 SOG console, 4401 w/o SOG, 4402 w/ SOG, 4102 LC→BB,
4103 Series 3000, 4104 Series 2500, 4105 PLYR/FL/PTS, 4601 HK→FB, 4602 LC→FB,
4701 HK→SOC, 4702 LC→SOC.

## Standard keys (p.7–10, Quick Reference p.223)

| Cluster | Keys |
|---|---|
| Number keypad | `7 8 9` / `4 5 6` / `1 2 3` / `CLEAR-NO`, `0`, `ENTER-*-YES` |
| Menu navigation | `▲` `◄` `MENU` `►` `▼`, with `EDIT` below |
| Horn control | `AUTO HORN •`, `HORN` (amber LED = auto horn enabled) |
| Clock control | `COUNT UP/DOWN •`, `SET MAIN CLOCK •`, `START` (green LED = running), `STOP` |

Behaviour worth preserving:

- `START` / `STOP` run the main clock; the LED on `START` mirrors it.
- `HORN` sounds only while held. `AUTO HORN` → `1`-ON / `2`-OFF; pressing `1`
  again with auto horn already on steps into the interval timer (p.78).
- `COUNT UP/DOWN` and `SET MAIN CLOCK` are disabled while the clock runs.
- `SET MAIN CLOCK` cycles CURR → PERIOD → BREAK → OT → PRE → POST. `ENTER` on
  any configured length loads it into the main clock, and doing so from zero
  increments the period.
- `CLEAR/NO` escapes: once when no digit has been typed, twice when digits are
  pending (the first press blanks them).
- `EDIT` + a statistic key opens that field for entry instead of incrementing.

## LCD prompts (Section 9, p.74–83)

| Trigger | Line 1 | Line 2 |
|---|---|---|
| power up | `AS-5000 VX.X.X` | `ED-11544` |
| power up | `PREV CODE NNNN` | `RESUME GAME?` |
| new code | `SELECT CODE` | `CODE NNNN` |
| SET MAIN CLOCK | `MAIN CLOCK -SET` | `CURR MM:SS:T *` |
| after setting the clock | `ADJUST PENALTY` | `TIMERS Y/N?` |
| COUNT UP/DOWN | `MAIN CLOCK- DOWN` | `1-UP 2-DOWN` |
| AUTO HORN | `AUTO HORN- ON` | `1-ON, 2-OFF` |
| interval timer | `HORN-INTERVAL` | `1-ON, 2-OFF OFF` → `TIME =M` |
| PLAYER PENALTY | `HOME PLYR/PEN` | `1 PNN PN MM:SS` |
| DELETE PENALTY | `HOME DEL PEN?` | `1 PNN PN MM:SS` |
| CLEAR ALL PENALTIES | `HOME PLYR/PEN` | `CLEAR ALL Y/N?` |
| TIME OUT (team) | `TIME OUTS-HOME` | `FULL N` / `PARTIAL N` / `NO TIME OUTS` |
| TIME OUT ON/OFF | `TIME OUTS-SELECT` | `FULL MM:SS` / `PARTIAL MM:SS` |
| SET SHOT TIME | `SHOT CLOCK-EDIT` | `CURR MM:SS*` → `RESET 1` → `RESET 2` |
| RECALL SHOT TIME | `SHOT CLOCK-MODE` | `RECALL Y/N` |
| PERIOD +1 | `PERIOD +1` | `N` |
| stat key | `TEAM SCORE- +1` | `HOME NNN` |
| EDIT + stat key | `TEAM SCORE- EDIT` | `HOME NNN*` |
| PENALTY (team) | `HOME PENALTY` | `ON` / `OFF` |

An `*` on the LCD is the reminder that `ENTER` is still needed.

## MENU tree (p.80–83)

`NEW GAME?` · `NEW CODE?` · `DIMMING MENU` · `HOME ROSTER` · `GUEST ROSTER` ·
`DISPLAY MENU` · `TIME OF DAY` · `EDIT SETTINGS?`

`EDIT SETTINGS` walks: main clock (tenths Y/N, period, break, overtime, pre,
post), number of periods (3 or 4), shot clock (reset 1, reset 2, sync with
main, auto blank), penalty times (minor, major), time outs (full count, full
length, warning, partial count, partial length, show on main), FIBA mode,
select captions, switch output.

Roster / team-name entry needs the LL-2441 Team Name insert fitted, so the
console cannot do it from the hockey insert.

## Default settings (p.84)

| Setting | Default |
|---|---|
| Tenth of a second | Yes |
| No. of periods | 3 |
| Period length | 15:00 |
| Break length | 10:00 |
| Overtime length | 5:00 |
| Pre-game length | 20:00 |
| Post-game length | 30:00 |
| Shot reset 1 | 0:45 |
| Shot reset 2 | 0:30 |
| Sync shot with main | Yes |
| Auto blank shot clock | Yes |
| Minor penalty | 2:00 |
| Major penalty | 5:00 |
| Full time outs | 1 |
| Full time out | 1:00 |
| Time out warning | 0:00 |
| Partial time outs | 0 |
| Partial time out | 0:00 |
| Show on main | No |
| Select captions | 1-ON |
| Switch output | 1-Clock = 0 |

## Regenerating the reference images

`docs/reference/*.png` came out of the PDF with PyMuPDF:

```python
import pymupdf
d = pymupdf.open('allsport500_manual.pdf')
d[200].get_pixmap(dpi=160).save('docs/reference/hockey-insert-LL-2436.png')  # PDF p.201
d[14].get_pixmap(dpi=170).save('docs/reference/console-layout.png')          # PDF p.15
```

Text for grepping: `pdftotext -layout allsport500_manual.pdf manual.txt`.
