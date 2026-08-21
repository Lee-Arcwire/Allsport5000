/* ====================================================================
   Daktronics All Sport 5000 Series control console emulator — hockey
   (sport insert LL-2436, codes 4401 / 4402).

   Modelled on ED-13530 "All Sport 5000 Series Operation Manual":
     - Section 2  Basic Operation / Standard Keys (p.5-10)
     - Section 9  Hockey/Lacrosse/Handball Operation (p.74-84)
     - Appendix B Sport insert LL-2436, DWG-124218 (p.201 of the PDF)
     - Appendix D Quick Reference: Standard Keys (p.223), Hockey (p.228)

   Console model:
     - The LCD is 2 lines x 16 characters. In game mode the top line shows
       the main clock plus the count direction arrow, and the bottom line
       shows H= / G= scores plus EN / DS for the penalty-clock state.
     - Every key that needs follow-up input opens a *screen*: a prompt on
       the LCD that consumes digits, ENTER/YES, CLEAR/NO and the arrow
       keys until it is committed or escaped. state.screen is that
       machine; state.buffer holds the digits typed so far.
     - <CLEAR/NO> escapes a screen: once if no digit has been typed, twice
       if digits are pending (first press blanks them) — as documented in
       Basic Operation.
     - <EDIT> followed by a statistic key opens that field for entry
       instead of incrementing it.
     - <START>/<STOP> run the main clock; the green LED on START mirrors
       it. <HORN> is press-and-hold; the amber LED on HORN mirrors the
       Auto Horn setting.

   Keyboard shortcuts:
     Space       START / STOP the main clock (the remote rocker switch)
     H (hold)    manual horn
     0-9         number pad
     Enter       ENTER / YES
     Esc         CLEAR / NO
     Backspace   delete one digit from the entry buffer
     Arrows      menu navigation
     M           MENU
     E           EDIT
   ==================================================================== */

(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------

  const LCD_COLS = 16;
  const SETTINGS_VERSION = 1;

  const MAX_SCORE     = 999;
  const MAX_STAT      = 999;   // shots on goal / saves
  const MAX_PERIOD    = 9;
  const MAX_TIMEOUTS  = 9;
  const MAX_PLAYER    = 99;
  const MAX_PENALTIES = 6;     // per team, queued
  // Scoreboards driven by codes 4401 / 4402 carry two penalty windows per
  // team, and only those count down (manual, Appendix C note 4).
  const COUNTING_PENALTIES = 2;

  const FLASH_MS        = 1400;
  const PERIOD_HORN_MS  = 2000;
  const INTERVAL_HORN_MS = 1000;
  const WARNING_HORN_MS  = 1000;
  const BOOT_MS         = 1400;

  const LS_SETTINGS = 'as5000.hockey.settings.v1';
  const LS_GAME     = 'as5000.hockey.game.v1';

  const ARROW_DOWN = '↓';
  const ARROW_UP   = '↑';

  // Codes printed on the LL-2436 insert.
  const INSERT_CODES = [
    ['4000', 'SOG CONSOLE'],
    ['4401', 'W/O SOG'],
    ['4402', 'W/ SOG'],
    ['4102', 'LC > BB'],
    ['4103', 'SERIES 3000'],
    ['4104', 'SERIES 2500'],
    ['4105', 'PLYR/FL/PTS'],
    ['4601', 'HK > FB'],
    ['4602', 'LC > FB'],
    ['4701', 'HK > SOC'],
    ['4702', 'LC > SOC'],
  ];

  // Factory defaults, from "Default Settings" (manual p.84).
  function defaultSettings() {
    return {
      settingsVersion: SETTINGS_VERSION,
      tenths:          true,
      periods:         3,
      periodMs:        15 * 60000,
      breakMs:         10 * 60000,
      overtimeMs:       5 * 60000,
      pregameMs:       20 * 60000,
      postgameMs:      30 * 60000,
      shotReset1Ms:    45 * 1000,
      shotReset2Ms:    30 * 1000,
      syncShotWithMain: true,
      autoBlankShot:   true,
      minorMs:          2 * 60000,
      majorMs:          5 * 60000,
      fullTimeOuts:    1,
      fullTimeOutMs:   60 * 1000,
      timeOutWarnMs:   0,
      partialTimeOuts: 0,
      partialTimeOutMs: 0,
      showOnMain:      false,
      fibaMode:        false,
      captions1:       true,
      captions2:       false,
      switchOutput:    1,          // 1 = Clock = 0
      countDown:       true,       // Count Up/Down (standard key)
      autoHorn:        true,       // Auto Horn (standard key)
      dimming:         'High',     // Dimming Menu
      homeName:        'HOME',
      guestName:       'GUEST',
    };
  }

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------

  function newTeam(settings) {
    return {
      score: 0,
      sog: 0,
      saves: 0,
      penaltyInd: false,               // <PENALTY> indicator lamp
      penalties: [],                   // [{ player, remainingMs }]
      fullLeft: settings.fullTimeOuts,
      partialLeft: settings.partialTimeOuts,
    };
  }

  const state = {
    settings: defaultSettings(),
    code: '4402',
    booting: true,

    home:  null,                       // filled by newGame()
    guest: null,
    period: 1,
    timeMs: 0,
    clockRunning: false,
    penaltyClocksEnabled: true,

    // Shot clock (driven by the remote shot-clock console on real
    // hardware; SET / RECALL SHOT TIME on the keypad edit it here).
    shot: { timeMs: 0, running: false, prevMs: null, blanked: false },

    // Time out clock, started by <TIME OUT> (team) or <TIME OUT ON/OFF>.
    timeOut: { active: false, kind: null, remainingMs: 0, warned: false },

    // Auto Horn Interval Timer (manual p.78).
    interval: { enabled: false, minutes: 1, nextAtMs: 0 },

    horn: { manual: false, autoUntil: 0, on: false },

    screen: null,                      // active LCD prompt, or null
    buffer: '',                        // digits typed into the screen
    editArmed: false,                  // <EDIT> pressed, awaiting a key
    // Set once <START> has been pressed this period; gates the "ADJUST
    // PENALTY TIMERS Y/N?" prompt after the main clock is set.
    clockHasRun: false,
    flash: null,                       // { line1, line2 }
    flashUntil: 0,
  };

  // ---------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const els = {
    homeScore: $('home-score'),
    guestScore: $('guest-score'),
    homeSog:   $('home-sog'),
    guestSog:  $('guest-sog'),
    period:    $('period'),
    time:      $('time'),
    timeBg:    $('time-bg'),
    lcd1:      $('lcd-line1'),
    lcd2:      $('lcd-line2'),
    activeCode: $('active-code'),
    insertCodes: $('insert-codes'),
    homePen: [
      { player: $('home-pen1-player'),  time: $('home-pen1-time')  },
      { player: $('home-pen2-player'),  time: $('home-pen2-time')  },
    ],
    guestPen: [
      { player: $('guest-pen1-player'), time: $('guest-pen1-time') },
      { player: $('guest-pen2-player'), time: $('guest-pen2-time') },
    ],
    // Assigned after buildKeypad().
    startBtn: null,
    hornBtn: null,
  };

  // ---------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && saved.settingsVersion === SETTINGS_VERSION) {
        Object.assign(state.settings, saved);
      }
    } catch (_) { /* corrupt or unavailable storage: keep defaults */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
    } catch (_) { /* ignore */ }
  }

  // The console offers "PREV CODE / RESUME GAME?" at power-up, so the game
  // in progress is snapshotted on every scoring change and clock stop.
  function saveGame() {
    try {
      localStorage.setItem(LS_GAME, JSON.stringify({
        code: state.code,
        period: state.period,
        timeMs: state.timeMs,
        penaltyClocksEnabled: state.penaltyClocksEnabled,
        shotMs: state.shot.timeMs,
        home: state.home,
        guest: state.guest,
      }));
    } catch (_) { /* ignore */ }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(LS_GAME);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ---------------------------------------------------------------
  // Audio (horn)
  // ---------------------------------------------------------------

  let audioCtx = null;
  let hornNodes = null;
  let audioPrimed = false;

  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  // Browsers block AudioContext startup until a user gesture, so the first
  // horn press would otherwise pay for the whole audio-stack warmup and
  // sound late. Prime on the first gesture anywhere in the page.
  function primeAudioOnce() {
    if (audioPrimed) return;
    ensureAudio();
    if (!audioCtx) return;
    try {
      const buf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      src.start();
    } catch (_) { /* older engines: ignore */ }
    audioPrimed = true;
  }

  function bindAudioPrimer() {
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const handler = () => {
      primeAudioOnce();
      if (audioPrimed) events.forEach(e => document.removeEventListener(e, handler, true));
    };
    events.forEach(e => document.addEventListener(e, handler, true));
  }

  function startHorn() {
    ensureAudio();
    if (!audioCtx || hornNodes) return;
    const now = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 220;
    osc2.type = 'square';
    osc2.frequency.value = 145;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.008);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);
    osc1.start();
    osc2.start();
    hornNodes = { osc1, osc2, gain };
  }

  function stopHorn() {
    if (!hornNodes || !audioCtx) return;
    const { osc1, osc2, gain } = hornNodes;
    const now = audioCtx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.06);
    osc1.stop(now + 0.08);
    osc2.stop(now + 0.08);
    hornNodes = null;
  }

  function soundHorn(ms) {
    state.horn.autoUntil = Math.max(state.horn.autoUntil, Date.now() + ms);
  }

  // ---------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------

  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtMMSS(ms) {
    if (ms < 0) ms = 0;
    const total = Math.ceil(ms / 1000);
    return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
  }

  // Main clock: MM:SS above a minute, SS.T below it when tenths are on.
  function fmtMain(ms) {
    if (ms < 0) ms = 0;
    if (!state.settings.tenths || ms >= 60000) return fmtMMSS(ms);
    const tenths = Math.floor(ms / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }

  // Penalty / time out windows drop the leading zero, like the board.
  function fmtPenalty(ms) {
    if (ms < 0) ms = 0;
    const total = Math.ceil(ms / 1000);
    return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
  }

  function parseMMSS(digits) {
    const d = String(digits).padStart(4, '0').slice(-4);
    return (+d.slice(0, 2)) * 60000 + (+d.slice(2)) * 1000;
  }

  // MMSST: the main clock accepts a tenths digit (manual: CURR MM:SS.T).
  function parseMMSST(digits) {
    const d = String(digits).padStart(5, '0').slice(-5);
    return (+d.slice(0, 2)) * 60000 + (+d.slice(2, 4)) * 1000 + (+d.slice(4)) * 100;
  }

  function previewMMSS(digits) {
    const d = String(digits).padStart(4, '0').slice(-4);
    return `${d.slice(0, 2)}:${d.slice(2)}`;
  }

  function previewMMSST(digits) {
    const d = String(digits).padStart(5, '0').slice(-5);
    return `${d.slice(0, 2)}:${d.slice(2, 4)}.${d.slice(4)}`;
  }

  function fmtTimeOfDay() {
    const now = new Date();
    let h = now.getHours() % 12;
    if (h === 0) h = 12;
    return `${h}:${pad2(now.getMinutes())} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
  }

  // Compose one 16-character LCD row: left text, right text flushed to
  // column 16, spaces between.
  function row(left, right = '') {
    const l = String(left).slice(0, LCD_COLS);
    const r = String(right).slice(0, LCD_COLS - l.length);
    return l + ' '.repeat(LCD_COLS - l.length - r.length) + r;
  }

  const teamLabel = (team) => (team === 'home' ? 'HOME' : 'GUEST');

  // ---------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------

  function newGame() {
    state.home  = newTeam(state.settings);
    state.guest = newTeam(state.settings);
    state.period = 1;
    state.timeMs = state.settings.periodMs;
    state.clockRunning = false;
    state.penaltyClocksEnabled = true;
    state.shot = {
      timeMs: state.settings.shotReset1Ms,
      running: false,
      prevMs: null,
      blanked: false,
    };
    state.timeOut = { active: false, kind: null, remainingMs: 0, warned: false };
    state.interval.nextAtMs = 0;
    state.screen = null;
    state.buffer = '';
    state.editArmed = false;
    state.clockHasRun = false;
    saveGame();
  }

  function resumeGame(saved) {
    newGame();
    if (!saved) return;
    state.code    = saved.code || state.code;
    state.period  = saved.period ?? 1;
    state.timeMs  = saved.timeMs ?? state.settings.periodMs;
    state.penaltyClocksEnabled = saved.penaltyClocksEnabled !== false;
    state.shot.timeMs = saved.shotMs ?? state.settings.shotReset1Ms;
    if (saved.home)  Object.assign(state.home,  saved.home);
    if (saved.guest) Object.assign(state.guest, saved.guest);
  }

  // ---------------------------------------------------------------
  // Screens (the LCD prompt state machine)
  // ---------------------------------------------------------------

  function open(screen) {
    state.screen = screen;
    state.buffer = '';
    // A prompt must appear immediately: don't let a stat/period flash from
    // the previous key press sit on the LCD in front of it.
    state.flashUntil = 0;
  }

  function closeScreen() {
    state.screen = null;
    state.buffer = '';
  }

  function flash(line1, line2, ms = FLASH_MS) {
    state.flash = { line1, line2 };
    state.flashUntil = Date.now() + ms;
  }

  // ---- Main clock ------------------------------------------------

  // <SET MAIN CLOCK> cycles CURR -> PERIOD -> BREAK -> OT -> PRE -> POST.
  const CLOCK_STEPS = [
    { tag: 'CURR', get: () => state.timeMs,                  set: (ms) => { state.timeMs = ms; }, live: true },
    { tag: 'PERIOD', key: 'periodMs' },
    { tag: 'BREAK',  key: 'breakMs' },
    { tag: 'OT',     key: 'overtimeMs' },
    { tag: 'PRE',    key: 'pregameMs' },
    { tag: 'POST',   key: 'postgameMs' },
  ];

  function pressSetMainClock() {
    if (state.clockRunning) { flash(row('MAIN CLOCK'), row('STOP CLOCK 1ST')); return; }
    if (state.screen && state.screen.kind === 'set-clock') {
      state.screen.step = (state.screen.step + 1) % CLOCK_STEPS.length;
      state.buffer = '';
      return;
    }
    open({ kind: 'set-clock', step: 0 });
  }

  function commitSetClock() {
    const s = state.screen;
    const step = CLOCK_STEPS[s.step];
    const wasZero = state.timeMs <= 0;

    if (state.buffer) {
      const ms = step.live ? parseMMSST(state.buffer) : parseMMSS(state.buffer);
      if (step.live) step.set(ms); else state.settings[step.key] = ms;
    }
    // ENTER on any of the configured lengths loads it into the main clock;
    // doing so from zero also advances the period (manual p.8 note).
    if (!step.live) {
      state.timeMs = state.settings[step.key];
      if (wasZero && step.tag === 'PERIOD' && state.period < MAX_PERIOD) state.period++;
      saveSettings();
    }
    // Penalty timers may need re-basing once the clock has been run.
    if (hasPenalties() && state.clockHasRun) {
      open({ kind: 'adjust-penalties', targetMs: state.timeMs });
      return;
    }
    closeScreen();
    saveGame();
  }

  function hasPenalties() {
    return state.home.penalties.length > 0 || state.guest.penalties.length > 0;
  }

  // ---- Player penalty -------------------------------------------

  // <PLAYER PENALTY> drops straight into jersey-number entry for a new
  // penalty - no ENTER needed to get there. The arrow keys (or another
  // press of the key) scroll onto an existing penalty to edit it instead.
  function pressPlayerPenalty(team) {
    const s = state.screen;
    if (s && s.kind === 'player-penalty' && s.team === team) {
      moveScreen(+1);
      return;
    }
    const arr = state[team].penalties;
    const screen = { kind: 'player-penalty', team, idx: penaltySlotCount(team) - 1 };
    open(screen);
    loadPenaltySlot(screen);
  }

  // Existing penalties, plus one empty slot to add to while there's room.
  function penaltySlotCount(team) {
    const n = state[team].penalties.length;
    return Math.max(1, n + (n < MAX_PENALTIES ? 1 : 0));
  }

  function loadPenaltySlot(s) {
    const p = state[s.team].penalties[s.idx];
    s.player = p ? p.player : null;
    s.timeMs = p ? p.remainingMs : state.settings.minorMs;
    // The displayed time starts as the default (minor, or the penalty being
    // edited); the first MINOR / MAJOR press replaces it rather than adding
    // to it. See pressPenaltyTime().
    s.timeTouched = false;
    s.step = 'player';
    state.buffer = '';
  }

  function penaltySlotLine(team, idx) {
    const p = state[team].penalties[idx];
    if (!p) return `${idx + 1} NEW PEN`;
    return `${idx + 1} P${pad2(p.player)} ${fmtPenalty(p.remainingMs)}`;
  }

  function commitPlayerPenalty() {
    const s = state.screen;
    const arr = state[s.team].penalties;

    if (s.step === 'player') {
      if (state.buffer) s.player = Math.min(MAX_PLAYER, +state.buffer);
      if (s.player == null) return;                 // no jersey number yet
      s.step = 'time';
      state.buffer = '';
      return;
    }
    // step === 'time'
    if (state.buffer) s.timeMs = parseMMSS(state.buffer);
    if (s.timeMs <= 0) { closeScreen(); return; }
    const entry = { player: s.player, remainingMs: s.timeMs };
    if (arr[s.idx]) arr[s.idx] = entry;
    else if (arr.length < MAX_PENALTIES) arr.push(entry);
    closeScreen();
    saveGame();
  }

  // <MINOR PENALTY> / <MAJOR PENALTY> set the penalty time while a player
  // penalty is being entered: the first press replaces whatever default is
  // showing, and each further press adds that key's configured time again
  // (manual p.76).
  function pressPenaltyTime(kind) {
    const s = state.screen;
    const add = kind === 'minor' ? state.settings.minorMs : state.settings.majorMs;
    if (s && s.kind === 'player-penalty' && s.step === 'time') {
      s.timeMs = (s.timeTouched && !state.buffer) ? s.timeMs + add : add;
      s.timeTouched = true;
      state.buffer = '';
      return;
    }
    flash(row(`${kind.toUpperCase()} PENALTY`), row(fmtPenalty(add)));
  }

  // ---- Delete / clear penalties ---------------------------------

  function pressDeletePenalty(team) {
    if (!state[team].penalties.length) {
      flash(row(`${teamLabel(team)} DEL PEN?`), row('NO PENALTIES'));
      return;
    }
    open({ kind: 'delete-penalty', team, idx: 0 });
  }

  function pressClearAll(team) {
    open({ kind: 'clear-all', team });
  }

  // ---- Time outs ------------------------------------------------

  function pressTimeOut(team) {
    const s = state.screen;
    // Repeated presses cycle FULL -> PARTIAL, skipping types that are
    // configured to zero (manual: only configured time outs are offered).
    if (s && s.kind === 'timeout-team' && s.team === team) {
      s.kind2 = nextTimeOutKind(s.kind2);
      return;
    }
    const kind = nextTimeOutKind(null);
    if (!kind) { flash(row(`TIME OUTS-${teamLabel(team).slice(0, 5)}`), row('NO TIME OUTS')); return; }
    open({ kind: 'timeout-team', team, kind2: kind });
  }

  function nextTimeOutKind(current) {
    const has = {
      full:    state.settings.fullTimeOuts > 0,
      partial: state.settings.partialTimeOuts > 0,
    };
    const order = ['full', 'partial'];
    const start = current ? (order.indexOf(current) + 1) % order.length : 0;
    for (let i = 0; i < order.length; i++) {
      const k = order[(start + i) % order.length];
      if (has[k]) return k;
    }
    return null;
  }

  function commitTeamTimeOut() {
    const s = state.screen;
    const t = state[s.team];
    const left = s.kind2 === 'full' ? t.fullLeft : t.partialLeft;
    if (left <= 0) {
      flash(row(`TIME OUTS-${teamLabel(s.team).slice(0, 5)}`), row('NO TIME OUTS'));
      closeScreen();
      return;
    }
    if (s.kind2 === 'full') t.fullLeft--; else t.partialLeft--;
    startTimeOutClock(s.kind2);
    closeScreen();
    saveGame();
  }

  function startTimeOutClock(kind) {
    const ms = kind === 'full' ? state.settings.fullTimeOutMs : state.settings.partialTimeOutMs;
    state.timeOut = { active: true, kind, remainingMs: ms, warned: false };
  }

  function pressTimeOutOnOff() {
    if (state.timeOut.active) {
      state.timeOut = { active: false, kind: null, remainingMs: 0, warned: false };
      flash(row('TIME OUTS-SELECT'), row('OFF'));
      return;
    }
    const s = state.screen;
    if (s && s.kind === 'timeout-onoff') { s.kind2 = nextTimeOutKind(s.kind2); return; }
    const kind = nextTimeOutKind(null);
    if (!kind) { flash(row('TIME OUTS-SELECT'), row('NONE SET')); return; }
    open({ kind: 'timeout-onoff', kind2: kind });
  }

  // ---- Shot clock -----------------------------------------------

  const SHOT_STEPS = [
    { tag: 'CURR',    get: () => state.shot.timeMs,           set: (ms) => { state.shot.timeMs = ms; } },
    { tag: 'RESET 1', get: () => state.settings.shotReset1Ms, set: (ms) => { state.settings.shotReset1Ms = ms; saveSettings(); } },
    { tag: 'RESET 2', get: () => state.settings.shotReset2Ms, set: (ms) => { state.settings.shotReset2Ms = ms; saveSettings(); } },
  ];

  function pressSetShotTime() {
    if (state.screen && state.screen.kind === 'set-shot') {
      state.screen.step = (state.screen.step + 1) % SHOT_STEPS.length;
      state.buffer = '';
      return;
    }
    open({ kind: 'set-shot', step: 0 });
  }

  function pressRecallShotTime() {
    if (state.shot.prevMs == null) {
      flash(row('SHOT CLOCK-MODE'), row('NO RECALL'));
      return;
    }
    open({ kind: 'recall-shot' });
  }

  function resetShotClock(which) {
    state.shot.prevMs = state.shot.timeMs;
    state.shot.timeMs = which === 2 ? state.settings.shotReset2Ms : state.settings.shotReset1Ms;
    state.shot.running = false;
  }

  // ---- Auto horn / interval timer -------------------------------

  function pressAutoHorn() {
    open({ kind: 'auto-horn', step: 'onoff' });
  }

  // ---- Statistics -----------------------------------------------

  const STATS = {
    score: { label: 'TEAM SCORE',    key: 'score', max: MAX_SCORE },
    sog:   { label: 'SHOTS ON GOAL', key: 'sog',   max: MAX_STAT  },
    saves: { label: 'SAVES',         key: 'saves', max: MAX_STAT  },
  };

  function pressStat(stat, team, delta) {
    const def = STATS[stat];
    if (state.editArmed) {
      state.editArmed = false;
      open({ kind: 'edit-stat', stat, team });
      return;
    }
    const t = state[team];
    t[def.key] = Math.max(0, Math.min(def.max, t[def.key] + delta));
    flash(row(`${def.label}- ${delta > 0 ? '+' : ''}${delta}`),
          row(teamLabel(team), String(t[def.key])));
    saveGame();
  }

  function pressPeriod() {
    if (state.editArmed) {
      state.editArmed = false;
      open({ kind: 'edit-period' });
      return;
    }
    // The period digit is a single character on the board, so <PERIOD +1>
    // cycles 0-9 and wraps back to 0 rather than sticking at 9.
    state.period = (state.period + 1) % (MAX_PERIOD + 1);
    flash(row('PERIOD +1'), row(`     ${state.period}`));
    saveGame();
  }

  function pressPenaltyIndicator(team) {
    const t = state[team];
    t.penaltyInd = !t.penaltyInd;
    flash(row(`${teamLabel(team)} PENALTY`), row(t.penaltyInd ? 'ON' : 'OFF'));
    saveGame();
  }

  function setPenaltyClocks(enabled) {
    state.penaltyClocksEnabled = enabled;
    flash(row('PENALTY CLOCKS'), row(enabled ? 'ENABLED' : 'DISABLED'));
    saveGame();
  }

  // ---- Clock control --------------------------------------------

  function pressStart() {
    if (state.clockRunning) return;
    if (state.settings.countDown && state.timeMs <= 0) return;
    state.clockRunning = true;
    state.clockHasRun = true;
    if (state.settings.syncShotWithMain) state.shot.running = true;
    if (state.interval.enabled) {
      state.interval.nextAtMs = state.interval.minutes * 60000;
    }
  }

  function pressStop() {
    if (!state.clockRunning) return;
    state.clockRunning = false;
    if (state.settings.syncShotWithMain) state.shot.running = false;
    saveGame();
  }

  function pressCountDirection() {
    if (state.clockRunning) { flash(row('MAIN CLOCK'), row('STOP CLOCK 1ST')); return; }
    open({ kind: 'count-dir' });
  }

  // ---- MENU -----------------------------------------------------

  const MENU_ITEMS = [
    { id: 'new-game',      line1: 'MENU- MAIN',    line2: 'NEW GAME?' },
    { id: 'new-code',      line1: 'MENU- MAIN',    line2: 'NEW CODE?' },
    { id: 'dimming',       line1: 'MENU- MAIN',    line2: 'DIMMING MENU?' },
    { id: 'home-roster',   line1: 'MENU- ROSTER',  line2: 'SELECT HOME' },
    { id: 'guest-roster',  line1: 'MENU- ROSTER',  line2: 'SELECT GUEST' },
    { id: 'display',       line1: 'MENU- MAIN',    line2: 'DISPLAY MENU?' },
    { id: 'time-of-day',   line1: 'MENU- MAIN',    line2: 'TIME OF DAY?' },
    { id: 'edit-settings', line1: 'MENU- MAIN',    line2: 'EDIT SETTINGS?' },
  ];

  // EDIT SETTINGS, in the order the manual walks them (p.81-83).
  const SETTINGS_ITEMS = [
    { key: 'tenths',           type: 'bool',   line1: 'MAIN CLOCK-MODE', label: 'TENTH SECOND?' },
    { key: 'periodMs',         type: 'time',   line1: 'MAIN CLOCK-TIME', label: 'PERIOD' },
    { key: 'breakMs',          type: 'time',   line1: 'MAIN CLOCK-TIME', label: 'BREAK' },
    { key: 'overtimeMs',       type: 'time',   line1: 'MAIN CLOCK-TIME', label: 'OVERTIME' },
    { key: 'pregameMs',        type: 'time',   line1: 'MAIN CLOCK-TIME', label: 'PRE' },
    { key: 'postgameMs',       type: 'time',   line1: 'MAIN CLOCK-TIME', label: 'POST' },
    { key: 'periods',          type: 'choice', line1: 'NO. OF PERIODS',  label: '3 OR 4?', choices: [3, 4] },
    { key: 'shotReset1Ms',     type: 'time',   line1: 'SHOT CLOCK-TIME', label: 'RESET 1' },
    { key: 'shotReset2Ms',     type: 'time',   line1: 'SHOT CLOCK-TIME', label: 'RESET 2' },
    { key: 'syncShotWithMain', type: 'bool',   line1: 'SHOT CLOCK-MODE', label: 'SYNC W/ MAIN?' },
    { key: 'autoBlankShot',    type: 'bool',   line1: 'SHOT CLOCK-MODE', label: 'AUTO BLANK?' },
    { key: 'minorMs',          type: 'time',   line1: 'PENALTY TIME',    label: 'MINOR' },
    { key: 'majorMs',          type: 'time',   line1: 'PENALTY TIME',    label: 'MAJOR' },
    { key: 'fullTimeOuts',     type: 'int',    line1: 'TIME OUTS- MODE', label: 'FULL',    max: MAX_TIMEOUTS },
    { key: 'fullTimeOutMs',    type: 'time',   line1: 'TIME OUTS- TIME', label: 'FULL' },
    { key: 'timeOutWarnMs',    type: 'time',   line1: 'TIME OUTS- TIME', label: 'WARNING' },
    { key: 'partialTimeOuts',  type: 'int',    line1: 'TIME OUTS- MODE', label: 'PARTIAL', max: MAX_TIMEOUTS },
    { key: 'partialTimeOutMs', type: 'time',   line1: 'TIME OUTS- TIME', label: 'PARTIAL' },
    { key: 'showOnMain',       type: 'bool',   line1: 'TIME OUTS-MODE',  label: 'SHOW ON MAIN?' },
    { key: 'fibaMode',         type: 'bool',   line1: 'FIBA MODE',       label: 'Y/N?' },
    { key: 'captions1',        type: 'bool',   line1: 'SELECT CAPTIONS', label: 'CONTROL 1' },
    { key: 'captions2',        type: 'bool',   line1: 'SELECT CAPTIONS', label: 'CONTROL 2' },
    { key: 'switchOutput',     type: 'choice', line1: 'SWITCH OUTPUT',   label: '1-CLK 2-HORN', choices: [1, 2] },
  ];

  function pressMenu() {
    if (state.screen && (state.screen.kind === 'menu' || state.screen.kind === 'edit-settings')) {
      closeScreen();
      return;
    }
    open({ kind: 'menu', idx: 0 });
  }

  function menuSelect() {
    const item = MENU_ITEMS[state.screen.idx];
    switch (item.id) {
      case 'new-game':
        newGame();
        flash(row('MENU- MAIN'), row('NEW GAME'));
        break;
      case 'new-code':
        open({ kind: 'select-code' });
        return;
      case 'dimming':
        open({ kind: 'dimming' });
        return;
      case 'home-roster':
      case 'guest-roster':
        // The TNMC name entry needs the LL-2441 Team Name insert; the
        // console can only re-enter names with that insert fitted.
        flash(row(`${item.id === 'home-roster' ? 'HOME' : 'GUEST'}- TEAM NAME`), row('USE LL-2441'));
        break;
      case 'display':
        flash(row('DISPLAY MENU'), row('NOT WIRED YET'));
        break;
      case 'time-of-day':
        flash(row('TIME OF DAY'), row(fmtTimeOfDay()), 2500);
        break;
      case 'edit-settings':
        open({ kind: 'edit-settings', idx: 0 });
        return;
    }
    closeScreen();
  }

  function settingsValueText(item) {
    const v = state.settings[item.key];
    switch (item.type) {
      case 'bool':   return v ? 'Y' : 'N';
      case 'time':   return fmtMMSS(v);
      case 'choice': return String(v);
      default:       return String(v);
    }
  }

  function commitSetting() {
    const item = SETTINGS_ITEMS[state.screen.idx];
    if (state.buffer) {
      if (item.type === 'time') state.settings[item.key] = parseMMSS(state.buffer);
      else if (item.type === 'int') state.settings[item.key] = Math.min(item.max ?? 99, +state.buffer);
      else if (item.type === 'choice') {
        const n = +state.buffer;
        if (item.choices.includes(n)) state.settings[item.key] = n;
      }
    }
    saveSettings();
    // Advance to the next setting, as the console does.
    state.screen.idx = (state.screen.idx + 1) % SETTINGS_ITEMS.length;
    state.buffer = '';
  }

  // ---------------------------------------------------------------
  // Number pad / ENTER / CLEAR routing
  // ---------------------------------------------------------------

  function digitLimit(s) {
    switch (s.kind) {
      case 'set-clock':     return CLOCK_STEPS[s.step].live ? 5 : 4;
      case 'set-shot':      return 4;
      case 'select-code':   return 4;
      case 'player-penalty': return s.step === 'player' ? 2 : 4;
      case 'edit-stat':     return 3;
      case 'edit-period':   return 1;
      case 'edit-settings': {
        const item = SETTINGS_ITEMS[s.idx];
        return item.type === 'time' ? 4 : item.type === 'int' ? 1 : 1;
      }
      default: return 4;
    }
  }

  function pressNum(d) {
    const s = state.screen;
    if (!s) return;

    // Y/N and 1/2 prompts consume the digit as a choice.
    switch (s.kind) {
      case 'count-dir':
        if (d === '1' || d === '2') {
          state.settings.countDown = d === '2';
          saveSettings();
          closeScreen();
        }
        return;
      case 'auto-horn':
        if (s.step === 'onoff') {
          if (d === '1') {
            // <1> with auto horn already on steps into the interval timer.
            if (state.settings.autoHorn) { s.step = 'interval'; return; }
            state.settings.autoHorn = true;
          } else if (d === '2') {
            state.settings.autoHorn = false;
            state.interval.enabled = false;
          } else return;
          saveSettings();
          closeScreen();
          return;
        }
        if (s.step === 'interval') {
          if (d === '1') { state.interval.enabled = true; s.step = 'interval-time'; }
          else if (d === '2') { state.interval.enabled = false; closeScreen(); }
          return;
        }
        if (s.step === 'interval-time') {
          const m = +d;
          if (m >= 1 && m <= 5) {
            state.interval.minutes = m;
            state.interval.nextAtMs = state.clockRunning ? m * 60000 : 0;
            closeScreen();
          }
          return;
        }
        return;
      case 'dimming':
        if (d === '1' || d === '2') {
          state.settings.dimming = d === '1' ? 'High' : 'Low';
          saveSettings();
          closeScreen();
        }
        return;
      case 'delete-penalty':
        // Digits pick a slot directly, arrows scroll.
        if (+d >= 1 && +d <= state[s.team].penalties.length) s.idx = +d - 1;
        return;
      default:
        break;
    }

    if (state.buffer.length >= digitLimit(s)) return;
    state.buffer += d;
  }

  function pressEnter() {
    const s = state.screen;
    if (!s) {
      // ENTER outside a prompt is the console's "no action" beep.
      return;
    }
    switch (s.kind) {
      case 'boot-resume': {
        const saved = loadGame();
        resumeGame(saved);
        closeScreen();
        break;
      }
      case 'select-code': {
        const code = state.buffer || state.code;
        state.code = String(code).padStart(4, '0');
        newGame();
        closeScreen();
        break;
      }
      case 'set-clock':        commitSetClock(); break;
      case 'adjust-penalties': adjustPenalties(true); break;
      case 'player-penalty':   commitPlayerPenalty(); break;
      case 'delete-penalty': {
        state[s.team].penalties.splice(s.idx, 1);
        closeScreen();
        saveGame();
        break;
      }
      case 'clear-all': {
        state[s.team].penalties = [];
        closeScreen();
        saveGame();
        break;
      }
      case 'timeout-team':  commitTeamTimeOut(); break;
      case 'timeout-onoff': startTimeOutClock(s.kind2); closeScreen(); break;
      case 'set-shot': {
        const step = SHOT_STEPS[s.step];
        if (state.buffer) step.set(parseMMSS(state.buffer));
        closeScreen();
        break;
      }
      case 'recall-shot': {
        const prev = state.shot.prevMs;
        state.shot.prevMs = state.shot.timeMs;
        state.shot.timeMs = prev;
        closeScreen();
        break;
      }
      case 'edit-stat': {
        const def = STATS[s.stat];
        if (state.buffer) {
          state[s.team][def.key] = Math.max(0, Math.min(def.max, +state.buffer));
        }
        closeScreen();
        saveGame();
        break;
      }
      case 'edit-period': {
        if (state.buffer) state.period = Math.max(0, Math.min(MAX_PERIOD, +state.buffer));
        closeScreen();
        saveGame();
        break;
      }
      case 'edit-timeouts': {
        const t = state[s.team];
        if (state.buffer) {
          const n = Math.min(MAX_TIMEOUTS, +state.buffer);
          if (s.step === 'full') t.fullLeft = n; else t.partialLeft = n;
        }
        if (s.step === 'full') { s.step = 'partial'; state.buffer = ''; }
        else { closeScreen(); saveGame(); }
        break;
      }
      case 'edit-timeout-times': {
        if (state.buffer) {
          const ms = parseMMSS(state.buffer);
          if (s.step === 'full') state.settings.fullTimeOutMs = ms;
          else state.settings.partialTimeOutMs = ms;
          saveSettings();
        }
        if (s.step === 'full') { s.step = 'partial'; state.buffer = ''; }
        else closeScreen();
        break;
      }
      case 'menu':          menuSelect(); break;
      case 'edit-settings': commitSetting(); break;
      default:              closeScreen(); break;
    }
  }

  // <CLEAR/NO>: one press escapes a fresh prompt, two when digits are
  // pending. It also answers NO to a Y/N prompt.
  function pressClear() {
    const s = state.screen;
    if (!s) {
      if (state.editArmed) state.editArmed = false;
      return;
    }
    if (state.buffer) { state.buffer = ''; return; }

    switch (s.kind) {
      case 'adjust-penalties': adjustPenalties(false); return;
      case 'boot-resume':      open({ kind: 'select-code' }); return;
      case 'recall-shot':      closeScreen(); return;
      case 'clear-all':        closeScreen(); return;
      case 'player-penalty':
        // Back out one step at a time, matching "press CLEAR twice". On the
        // time step CLEAR first undoes MINOR / MAJOR presses back to the
        // default, per the manual's note about pressing them too many times.
        if (s.step === 'time' && s.timeTouched) {
          const p = state[s.team].penalties[s.idx];
          s.timeMs = p ? p.remainingMs : state.settings.minorMs;
          s.timeTouched = false;
          return;
        }
        if (s.step === 'time') { s.step = 'player'; return; }
        closeScreen();
        return;
      default:
        closeScreen();
    }
  }

  function pressUp()   { moveScreen(-1); }
  function pressDown() { moveScreen(+1); }

  function moveScreen(dir) {
    const s = state.screen;
    if (!s) return;
    switch (s.kind) {
      case 'menu':
        s.idx = (s.idx + dir + MENU_ITEMS.length) % MENU_ITEMS.length;
        break;
      case 'edit-settings':
        s.idx = (s.idx + dir + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length;
        state.buffer = '';
        break;
      case 'player-penalty': {
        // Scroll onto another penalty for this team (or the empty slot at
        // the end) and load its values into the entry.
        const n = penaltySlotCount(s.team);
        s.idx = (s.idx + dir + n) % n;
        loadPenaltySlot(s);
        break;
      }
      case 'delete-penalty': {
        const n = state[s.team].penalties.length;
        if (n) s.idx = (s.idx + dir + n) % n;
        break;
      }
      case 'set-clock':
        s.step = (s.step + dir + CLOCK_STEPS.length) % CLOCK_STEPS.length;
        state.buffer = '';
        break;
      case 'set-shot':
        s.step = (s.step + dir + SHOT_STEPS.length) % SHOT_STEPS.length;
        state.buffer = '';
        break;
      default:
        break;
    }
  }

  // Re-basing penalty clocks after the main clock is set (manual p.76).
  function adjustPenalties(yes) {
    if (yes) {
      const target = state.screen.targetMs;
      for (const team of ['home', 'guest']) {
        for (const p of state[team].penalties) {
          p.remainingMs = Math.min(p.remainingMs, target);
        }
      }
    }
    closeScreen();
    saveGame();
  }

  // ---------------------------------------------------------------
  // LCD rendering
  // ---------------------------------------------------------------

  function gameLines() {
    const dir = state.settings.countDown ? ARROW_DOWN : ARROW_UP;
    const iv  = state.interval.enabled ? 'i' : ' ';

    if (state.timeOut.active) {
      // 16 columns only: the running time out gets the top line as
      // "T/O FULL     1:00", leaving the score line untouched.
      return [
        row(`T/O ${state.timeOut.kind === 'full' ? 'FULL' : 'PART'}`,
            fmtPenalty(state.timeOut.remainingMs)),
        scoreLine(),
      ];
    }
    return [
      row('TIME', `${fmtMain(state.timeMs)} ${iv}${dir}`),
      scoreLine(),
    ];
  }

  function scoreLine() {
    const h = String(state.home.score).padStart(3);
    const g = String(state.guest.score).padStart(3);
    return row(`H=${h} G=${g}`, state.penaltyClocksEnabled ? 'EN' : 'DS');
  }

  function screenLines() {
    const s = state.screen;
    const buf = state.buffer;
    const star = '*';

    switch (s.kind) {
      case 'boot-resume':
        return [row(`PREV CODE ${state.code}`), row('RESUME GAME?')];

      case 'select-code':
        return [row('SELECT CODE'), row('CODE', buf ? buf.padStart(4, '_') : state.code)];

      case 'set-clock': {
        const step = CLOCK_STEPS[s.step];
        const val = step.live
          ? (buf ? previewMMSST(buf) : `${fmtMMSS(state.timeMs)}.${Math.floor((state.timeMs % 1000) / 100)}`)
          : (buf ? previewMMSS(buf) : fmtMMSS(state.settings[step.key]));
        return [
          row(`MAIN CLOCK -${step.live ? 'SET' : 'EDIT'}`),
          row(step.tag, `${val} ${star}`),
        ];
      }

      case 'adjust-penalties':
        return [row('ADJUST PENALTY'), row('TIMERS Y/N?')];

      case 'count-dir':
        return [row('MAIN CLOCK-', state.settings.countDown ? 'DOWN' : 'UP'), row('1-UP 2-DOWN')];

      case 'auto-horn':
        if (s.step === 'onoff') {
          return [row('AUTO HORN-', state.settings.autoHorn ? 'ON' : 'OFF'), row('1-ON, 2-OFF')];
        }
        if (s.step === 'interval') {
          return [row('HORN-INTERVAL'), row('1-ON, 2-OFF', state.interval.enabled ? 'ON' : 'OFF')];
        }
        return [row('HORN-INTERVAL'), row(`TIME =${state.interval.minutes}`)];

      case 'dimming':
        return [row('DIMMING MENU'), row('1-HIGH 2-LOW', state.settings.dimming.slice(0, 4).toUpperCase())];

      case 'player-penalty': {
        const l1 = row(`${teamLabel(s.team)} PLYR/PEN`);
        // The slot number leads the line so scrolling shows which of the
        // team's penalties is being edited.
        if (s.step === 'player') {
          const p = buf ? buf.padStart(2, '_') : (s.player == null ? '--' : pad2(s.player));
          return [l1, row(`${s.idx + 1} PLAYER`, `${p} ${star}`)];
        }
        const t = buf ? previewMMSS(buf) : fmtMMSS(s.timeMs);
        return [l1, row(`${s.idx + 1} P${s.player == null ? '--' : pad2(s.player)}`, `${t} ${star}`)];
      }

      case 'delete-penalty':
        return [row(`${teamLabel(s.team)} DEL PEN?`), row(penaltySlotLine(s.team, s.idx))];

      case 'clear-all':
        return [row(`${teamLabel(s.team)} PLYR/PEN`), row('CLEAR ALL Y/N?')];

      case 'timeout-team': {
        const t = state[s.team];
        const left = s.kind2 === 'full' ? t.fullLeft : t.partialLeft;
        return [
          row(`TIME OUTS-${teamLabel(s.team).slice(0, 5)}`),
          row(s.kind2 === 'full' ? 'FULL' : 'PARTIAL', String(left)),
        ];
      }

      case 'timeout-onoff': {
        const ms = s.kind2 === 'full' ? state.settings.fullTimeOutMs : state.settings.partialTimeOutMs;
        return [row('TIME OUTS-SELECT'), row(s.kind2 === 'full' ? 'FULL' : 'PARTIAL', fmtMMSS(ms))];
      }

      case 'set-shot': {
        const step = SHOT_STEPS[s.step];
        const val = buf ? previewMMSS(buf) : fmtMMSS(step.get());
        return [row('SHOT CLOCK-EDIT'), row(step.tag, `${val} ${star}`)];
      }

      case 'recall-shot':
        return [row('SHOT CLOCK-MODE'), row('RECALL Y/N')];

      case 'edit-stat': {
        const def = STATS[s.stat];
        const cur = buf || String(state[s.team][def.key]);
        return [row(`${def.label}- EDIT`), row(teamLabel(s.team), `${cur} ${star}`)];
      }

      case 'edit-period':
        return [row('PERIOD- EDIT'), row('', `${buf || state.period} ${star}`)];

      case 'edit-timeouts': {
        const t = state[s.team];
        const cur = buf || String(s.step === 'full' ? t.fullLeft : t.partialLeft);
        return [
          row(`TIME OUTS-${teamLabel(s.team).slice(0, 5)}`),
          row(s.step === 'full' ? 'FULL' : 'PARTIAL', `${cur} ${star}`),
        ];
      }

      case 'edit-timeout-times': {
        const ms = s.step === 'full' ? state.settings.fullTimeOutMs : state.settings.partialTimeOutMs;
        const cur = buf ? previewMMSS(buf) : fmtMMSS(ms);
        return [row('TIME OUTS-EDIT'), row(s.step === 'full' ? 'FULL' : 'PARTIAL', `${cur} ${star}`)];
      }

      case 'menu': {
        const item = MENU_ITEMS[s.idx];
        return [row(item.line1), row(item.line2)];
      }

      case 'edit-settings': {
        const item = SETTINGS_ITEMS[s.idx];
        const cur = buf
          ? (item.type === 'time' ? previewMMSS(buf) : buf)
          : settingsValueText(item);
        return [row(item.line1), row(item.label, `${cur} ${star}`)];
      }

      default:
        return gameLines();
    }
  }

  function lcdLines() {
    if (state.booting) return [row('AS-5000 V1.0.0'), row('ED-11544')];
    if (state.flash && Date.now() < state.flashUntil) {
      return [state.flash.line1, state.flash.line2];
    }
    if (state.editArmed) return [row('EDIT'), row('SELECT A KEY')];
    if (state.screen) return screenLines();
    return gameLines();
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  function renderScoreboard() {
    els.homeScore.textContent  = pad2(state.home.score);
    els.guestScore.textContent = pad2(state.guest.score);
    els.homeSog.textContent    = pad2(state.home.sog);
    els.guestSog.textContent   = pad2(state.guest.sog);
    els.period.textContent     = String(state.period);

    // Time Outs > Show on Main puts the time out clock in the clock digits.
    const showTimeOut = state.timeOut.active && state.settings.showOnMain;
    const displayMs = showTimeOut ? state.timeOut.remainingMs : state.timeMs;
    els.time.textContent   = showTimeOut ? fmtPenalty(displayMs) : fmtMain(displayMs);
    els.timeBg.textContent = (!showTimeOut && state.settings.tenths && displayMs < 60000) ? '88.8' : '88:88';

    renderPenaltySlots(els.homePen,  state.home.penalties);
    renderPenaltySlots(els.guestPen, state.guest.penalties);
  }

  function renderPenaltySlots(slots, penalties) {
    for (let i = 0; i < slots.length; i++) {
      const p = penalties[i];
      slots[i].player.textContent = p ? pad2(p.player) : '--';
      slots[i].time.textContent   = p ? fmtPenalty(p.remainingMs) : '0:00';
    }
  }

  function renderConsole() {
    const [l1, l2] = lcdLines();
    els.lcd1.textContent = l1;
    els.lcd2.textContent = l2;
    els.activeCode.textContent = state.code;

    document.body.classList.toggle('brightness-low', state.settings.dimming === 'Low');

    if (els.startBtn) els.startBtn.classList.toggle('led-on', state.clockRunning);
    if (els.hornBtn)  els.hornBtn.classList.toggle('led-on', state.settings.autoHorn);

    // Highlight the key whose value the LCD is waiting on.
    const sel = armedSelector();
    document.querySelectorAll('.key.armed').forEach(k => {
      if (!sel || !k.matches(sel)) k.classList.remove('armed');
    });
    if (sel) document.querySelector(sel)?.classList.add('armed');
  }

  function armedSelector() {
    if (state.editArmed) return '[data-action="edit"]';
    const s = state.screen;
    if (!s) return null;
    switch (s.kind) {
      case 'set-clock':      return '[data-action="set-main-clock"]';
      case 'count-dir':      return '[data-action="count-dir"]';
      case 'auto-horn':      return '[data-action="auto-horn"]';
      case 'set-shot':       return '[data-action="set-shot"]';
      case 'recall-shot':    return '[data-action="recall-shot"]';
      case 'player-penalty': return `[data-action="player-penalty"][data-team="${s.team}"]`;
      case 'delete-penalty': return `[data-action="delete-penalty"][data-team="${s.team}"]`;
      case 'clear-all':      return `[data-action="clear-all"][data-team="${s.team}"]`;
      case 'timeout-team':   return `[data-action="timeout"][data-team="${s.team}"]`;
      case 'timeout-onoff':  return '[data-action="timeout-onoff"]';
      case 'menu':
      case 'edit-settings':  return '[data-action="menu"]';
      default:               return null;
    }
  }

  // ---------------------------------------------------------------
  // Tick loop
  // ---------------------------------------------------------------

  let lastTick = performance.now();
  let bootUntil = 0;

  function tick(now) {
    const dt = now - lastTick;
    lastTick = now;

    if (state.booting && Date.now() >= bootUntil) {
      state.booting = false;
      const saved = loadGame();
      if (saved) open({ kind: 'boot-resume' });
      else open({ kind: 'select-code' });
    }

    if (state.clockRunning) {
      advanceMainClock(dt);
      if (state.penaltyClocksEnabled) {
        tickPenalties(state.home.penalties,  dt);
        tickPenalties(state.guest.penalties, dt);
      }
      if (state.shot.running) advanceShotClock(dt);
      if (state.interval.enabled && state.settings.autoHorn) advanceInterval(dt);
    }

    if (state.timeOut.active) advanceTimeOut(dt);

    // Auto Blank Shot Clock: hide the shot time once it can no longer
    // expire before the period does.
    state.shot.blanked = state.settings.autoBlankShot &&
                         state.shot.timeMs >= state.timeMs &&
                         state.timeMs > 0;

    const desired = state.horn.manual || Date.now() < state.horn.autoUntil;
    if (desired && !state.horn.on)      { state.horn.on = true;  startHorn(); }
    else if (!desired && state.horn.on) { state.horn.on = false; stopHorn(); }

    renderScoreboard();
    renderConsole();
    requestAnimationFrame(tick);
  }

  function advanceMainClock(dt) {
    if (state.settings.countDown) {
      if (state.timeMs <= 0) return;
      state.timeMs -= dt;
      if (state.timeMs <= 0) {
        state.timeMs = 0;
        state.clockRunning = false;
        state.shot.running = false;
        if (state.settings.autoHorn) soundHorn(PERIOD_HORN_MS);
        saveGame();
      }
    } else {
      state.timeMs += dt;
      const limit = state.settings.periodMs;
      if (limit > 0 && state.timeMs >= limit) {
        state.timeMs = limit;
        state.clockRunning = false;
        state.shot.running = false;
        if (state.settings.autoHorn) soundHorn(PERIOD_HORN_MS);
        saveGame();
      }
    }
  }

  function tickPenalties(arr, dt) {
    if (!arr.length) return;
    const active = Math.min(COUNTING_PENALTIES, arr.length);
    for (let i = 0; i < active; i++) arr[i].remainingMs -= dt;
    while (arr.length && arr[0].remainingMs <= 0) arr.shift();
  }

  function advanceShotClock(dt) {
    if (state.shot.timeMs <= 0) return;
    state.shot.timeMs -= dt;
    if (state.shot.timeMs <= 0) {
      state.shot.timeMs = 0;
      state.shot.running = false;
      soundHorn(INTERVAL_HORN_MS);
    }
  }

  function advanceInterval(dt) {
    if (state.interval.nextAtMs <= 0) {
      state.interval.nextAtMs = state.interval.minutes * 60000;
      return;
    }
    state.interval.nextAtMs -= dt;
    if (state.interval.nextAtMs <= 0) {
      soundHorn(INTERVAL_HORN_MS);
      state.interval.nextAtMs = state.interval.minutes * 60000;
    }
  }

  function advanceTimeOut(dt) {
    state.timeOut.remainingMs -= dt;
    const warn = state.settings.timeOutWarnMs;
    if (warn > 0 && !state.timeOut.warned && state.timeOut.remainingMs <= warn) {
      state.timeOut.warned = true;
      soundHorn(WARNING_HORN_MS);
    }
    if (state.timeOut.remainingMs <= 0) {
      state.timeOut = { active: false, kind: null, remainingMs: 0, warned: false };
      soundHorn(WARNING_HORN_MS);
    }
  }

  // ---------------------------------------------------------------
  // Dispatcher
  // ---------------------------------------------------------------

  function doAction(action, val, team) {
    switch (action) {
      // Sport insert — team keys
      case 'score':           pressStat('score', team, Number(val)); break;
      case 'sog':             pressStat('sog',   team, Number(val)); break;
      case 'saves':           pressStat('saves', team, Number(val)); break;
      case 'timeout':
        if (state.editArmed) { state.editArmed = false; open({ kind: 'edit-timeouts', team, step: 'full' }); }
        else pressTimeOut(team);
        break;
      case 'penalty-ind':     pressPenaltyIndicator(team); break;
      case 'player-penalty':  pressPlayerPenalty(team); break;
      case 'delete-penalty':  pressDeletePenalty(team); break;
      case 'clear-all':       pressClearAll(team); break;

      // Sport insert — game keys
      case 'recall-shot':     pressRecallShotTime(); break;
      case 'set-shot':        pressSetShotTime(); break;
      case 'timeout-onoff':
        if (state.editArmed) { state.editArmed = false; open({ kind: 'edit-timeout-times', step: 'full' }); }
        else pressTimeOutOnOff();
        break;
      case 'pen-enable':      setPenaltyClocks(true); break;
      case 'pen-disable':     setPenaltyClocks(false); break;
      case 'minor':           pressPenaltyTime('minor'); break;
      case 'major':           pressPenaltyTime('major'); break;
      case 'period':          pressPeriod(); break;

      // Standard keys
      case 'num':             pressNum(val); break;
      case 'enter':           pressEnter(); break;
      case 'clear':           pressClear(); break;
      case 'up':              pressUp(); break;
      case 'down':            pressDown(); break;
      case 'left':            pressUp(); break;    // the console's left/right
      case 'right':           pressDown(); break;  // walk the same list
      case 'menu':            pressMenu(); break;
      case 'edit':            state.editArmed = !state.editArmed; break;
      case 'auto-horn':       pressAutoHorn(); break;
      case 'count-dir':       pressCountDirection(); break;
      case 'set-main-clock':  pressSetMainClock(); break;
      case 'start':           pressStart(); break;
      case 'stop':            pressStop(); break;
    }
  }

  // ---------------------------------------------------------------
  // Keypad layout
  // ---------------------------------------------------------------
  // Each cluster is a CSS grid; r / c place the key, span widens it. The
  // geometry mirrors insert DWG-124218 and the console face photo
  // (Figure 3, manual p.5): 3 columns x 4 rows per insert group, with the
  // gaps the real insert leaves empty.

  const teamKeys = (team) => [
    { r: 1, c: 1, text: 'SCORE\n+1',        action: 'score', val: '+1' },
    { r: 1, c: 2, text: 'SCORE\n-1',        action: 'score', val: '-1' },
    { r: 1, c: 3, text: `TIME OUT\n${team === 'home' ? '◄' : '►'}`, action: 'timeout' },
    { r: 2, c: 1, text: 'SHOTS\nON GOAL\n+1', action: 'sog', val: '+1' },
    { r: 2, c: 2, text: 'SHOTS\nON GOAL\n-1', action: 'sog', val: '-1' },
    { r: 3, c: 1, text: 'SAVES\n+1',        action: 'saves', val: '+1' },
    { r: 3, c: 2, text: 'SAVES\n-1',        action: 'saves', val: '-1' },
    { r: 3, c: 3, text: `PENALTY\n${team === 'home' ? '◄' : '►'}`, action: 'penalty-ind' },
    { r: 4, c: 1, text: 'PLAYER\nPENALTY',  action: 'player-penalty', dot: true },
    { r: 4, c: 2, text: 'DELETE\nPENALTY',  action: 'delete-penalty', dot: true },
    { r: 4, c: 3, text: 'CLEAR\nALL\nPENALTIES', action: 'clear-all', dot: true },
  ];

  const GAME_KEYS = [
    { r: 1, c: 1, text: 'RECALL\nSHOT\nTIME',      action: 'recall-shot' },
    { r: 1, c: 2, text: 'SET\nSHOT\nTIME',         action: 'set-shot' },
    { r: 1, c: 3, text: 'TIME OUT\nON / OFF',      action: 'timeout-onoff' },
    { r: 2, c: 2, text: 'ENABLE\nPENALTY\nCLOCKS', action: 'pen-enable' },
    { r: 2, c: 3, text: 'DISABLE\nPENALTY\nCLOCKS', action: 'pen-disable' },
    { r: 3, c: 2, text: 'MINOR\nPENALTY',          action: 'minor' },
    { r: 3, c: 3, text: 'MAJOR\nPENALTY',          action: 'major' },
    { r: 4, c: 3, text: 'PERIOD\n+1',              action: 'period' },
  ];

  const NUM_KEYS = [
    { r: 1, c: 1, text: '7', action: 'num', val: '7' },
    { r: 1, c: 2, text: '8', action: 'num', val: '8' },
    { r: 1, c: 3, text: '9', action: 'num', val: '9' },
    { r: 2, c: 1, text: '4', action: 'num', val: '4' },
    { r: 2, c: 2, text: '5', action: 'num', val: '5' },
    { r: 2, c: 3, text: '6', action: 'num', val: '6' },
    { r: 3, c: 1, text: '1', action: 'num', val: '1' },
    { r: 3, c: 2, text: '2', action: 'num', val: '2' },
    { r: 3, c: 3, text: '3', action: 'num', val: '3' },
    { r: 4, c: 1, text: 'CLEAR\nNO',    action: 'clear', label: 'CLEAR / NO' },
    { r: 4, c: 2, text: '0', action: 'num', val: '0' },
    { r: 4, c: 3, text: 'ENTER\n✱ YES', action: 'enter', label: 'ENTER / YES' },
  ];

  const NAV_KEYS = [
    { r: 1, c: 2, text: '▲', action: 'up',    cls: 'key-arrow', label: 'up' },
    { r: 2, c: 1, text: '◄', action: 'left',  cls: 'key-arrow', label: 'left' },
    { r: 2, c: 2, text: 'MENU',   action: 'menu',  cls: 'key-menu' },
    { r: 2, c: 3, text: '►', action: 'right', cls: 'key-arrow', label: 'right' },
    { r: 3, c: 2, text: '▼', action: 'down',  cls: 'key-arrow', label: 'down' },
    { r: 4, c: 1, span: 3, text: 'EDIT', action: 'edit' },
  ];

  const HORN_KEYS = [
    { r: 1, c: 1, text: 'AUTO\nHORN', action: 'auto-horn', dot: true },
    { r: 1, c: 2, text: 'HORN', action: 'horn', cls: 'key-horn key-led led-amber', id: 'horn-key' },
  ];

  const CLOCK_KEYS = [
    { r: 1, c: 1, text: 'COUNT\nUP/DOWN',   action: 'count-dir',      dot: true },
    { r: 2, c: 1, text: 'SET\nMAIN\nCLOCK', action: 'set-main-clock', dot: true },
    { r: 1, c: 2, text: 'START', action: 'start', cls: 'key-start key-led', id: 'start-key' },
    { r: 2, c: 2, text: 'STOP',  action: 'stop',  cls: 'key-stop' },
  ];

  function buildKeys(containerId, keys, team) {
    const host = $(containerId);
    if (!host) return;
    for (const k of keys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key' + (k.cls ? ` ${k.cls}` : '') + (k.dot ? ' key-dot' : '') +
                      (team ? ` key-${team}` : '');
      btn.textContent = k.text;
      btn.dataset.action = k.action;
      if (k.val != null) btn.dataset.val = k.val;
      if (team) btn.dataset.team = team;
      if (k.id) btn.id = k.id;
      btn.style.gridRow = String(k.r);
      btn.style.gridColumn = k.span ? `${k.c} / span ${k.span}` : String(k.c);
      const name = (k.label || k.text).replace(/\n/g, ' ');
      btn.setAttribute('aria-label', team ? `${teamLabel(team)} ${name}` : name);
      host.appendChild(btn);
    }
  }

  function buildInsertCodes() {
    const host = els.insertCodes;
    if (!host) return;
    for (const [code, type] of INSERT_CODES) {
      const tr = document.createElement('tr');
      if (code === state.code) tr.className = 'active';
      tr.innerHTML = `<td>${code}</td><td>${type}</td>`;
      host.appendChild(tr);
    }
  }

  function buildKeypad() {
    buildKeys('keys-home',  teamKeys('home'),  'home');
    buildKeys('keys-guest', teamKeys('guest'), 'guest');
    buildKeys('keys-game',  GAME_KEYS);
    buildKeys('keys-num',   NUM_KEYS);
    buildKeys('keys-nav',   NAV_KEYS);
    buildKeys('keys-horn',  HORN_KEYS);
    buildKeys('keys-clock', CLOCK_KEYS);
    buildInsertCodes();
  }

  // ---------------------------------------------------------------
  // UI bindings
  // ---------------------------------------------------------------

  function setHornManual(on) { state.horn.manual = !!on; }

  function bindKeypad() {
    document.querySelectorAll('.key').forEach(btn => {
      const action = btn.dataset.action;
      if (!action) return;

      // HORN sounds only while held, like the physical key.
      if (action === 'horn') {
        const press = (e) => {
          e.preventDefault();
          ensureAudio();
          btn.classList.add('pressed');
          setHornManual(true);
        };
        const release = (e) => {
          e.preventDefault();
          btn.classList.remove('pressed');
          setHornManual(false);
        };
        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup', release);
        btn.addEventListener('mouseleave', release);
        btn.addEventListener('touchstart', press, { passive: false });
        btn.addEventListener('touchend', release);
        btn.addEventListener('touchcancel', release);
        return;
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        ensureAudio();
        doAction(action, btn.dataset.val, btn.dataset.team);
        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 90);
      });
    });
  }

  function bindKeyboard() {
    let hornHeld = false;

    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

      if (e.key === ' ' || e.code === 'Space') {
        // The remote rocker switch: one key toggles START / STOP.
        e.preventDefault();
        if (e.repeat) return;
        ensureAudio();
        if (state.clockRunning) pressStop(); else pressStart();
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        if (!hornHeld) {
          hornHeld = true;
          ensureAudio();
          setHornManual(true);
          els.hornBtn?.classList.add('pressed');
        }
        return;
      }
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); ensureAudio(); pressNum(e.key); return; }
      if (e.key === 'Enter')     { e.preventDefault(); ensureAudio(); pressEnter(); return; }
      if (e.key === 'Escape')    { e.preventDefault(); pressClear(); return; }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (state.buffer) state.buffer = state.buffer.slice(0, -1);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')    { e.preventDefault(); pressUp(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); pressDown(); return; }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); pressMenu(); return; }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); state.editArmed = !state.editArmed; return; }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'h' || e.key === 'H') {
        hornHeld = false;
        setHornManual(false);
        els.hornBtn?.classList.remove('pressed');
      }
    });

    window.addEventListener('blur', () => {
      hornHeld = false;
      setHornManual(false);
      els.hornBtn?.classList.remove('pressed');
    });
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------

  function init() {
    loadSettings();
    newGame();
    buildKeypad();
    els.startBtn = $('start-key');
    els.hornBtn  = $('horn-key');
    bindKeypad();
    bindKeyboard();
    bindAudioPrimer();
    bootUntil = Date.now() + BOOT_MS;
    requestAnimationFrame((t) => { lastTick = t; tick(t); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
