(function () {
  'use strict';

  /* ============================================================
     DOM REFERENCES
  ============================================================ */
  const roadEl        = document.getElementById('road');
  const playerEl       = document.getElementById('player');
  const starsEl        = document.getElementById('stars');
  const scoreEl        = document.getElementById('score');
  const highscoreEl    = document.getElementById('highscore');
  const startScreen    = document.getElementById('start-screen');
  const startBtn       = document.getElementById('start-btn');
  const startHighEl    = document.getElementById('start-highscore');
  const gameOverScreen = document.getElementById('gameover-screen');
  const finalScoreEl   = document.getElementById('final-score');
  const finalHighEl    = document.getElementById('final-high');
  const newBestEl      = document.getElementById('new-best');
  const restartBtn     = document.getElementById('restart-btn');
  const touchLayer     = document.getElementById('touch-layer');

  const PLAYER_WIDTH  = 64;
  const PLAYER_HEIGHT = 84;
  const HIGH_SCORE_KEY = 'nightRunnerHighScore';

  /* ============================================================
     STATE
  ============================================================ */
  let laneCenters = [0, 0, 0];
  let roadWidth = 0;
  let roadHeight = 0;

  let currentLane = 1;
  let score = 0;
  let highScore = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || '0', 10);
  let running = false;
  let gameStarted = false;

  let speed = 260;          // px per second, item fall speed
  const START_SPEED = 260;
  const MAX_SPEED = 620;
  const SPEED_RAMP = 2.2;   // px/s gained per second survived

  let spawnTimer = 0;
  let spawnInterval = 1300; // ms
  const MIN_SPAWN_INTERVAL = 650;

  let elapsed = 0;          // ms survived this run
  let lastFrameTime = 0;
  let rafId = null;

  const items = []; // {el, type:'coin'|'obstacle', lane, y, width, height, handled}

  highscoreEl.textContent = highScore;
  startHighEl.textContent = highScore;

  /* ============================================================
     AUDIO (Web Audio API - generated sounds, no external files)
  ============================================================ */
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playCoinSound() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(1500, t0 + 0.08);
    gain.gain.setValueAtTime(0.18, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  function playCrashSound() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.4);
    gain.gain.setValueAtTime(0.22, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.46);
  }

  /* ============================================================
     STARFIELD
  ============================================================ */
  function buildStars() {
    starsEl.innerHTML = '';
    const count = 45;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 55 + '%';
      s.style.animationDelay = (Math.random() * 2.5).toFixed(2) + 's';
      const size = Math.random() < 0.2 ? 3 : 2;
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      starsEl.appendChild(s);
    }
  }

  /* ============================================================
     LAYOUT / LANES
  ============================================================ */
  function computeLayout() {
    roadWidth = roadEl.clientWidth;
    roadHeight = roadEl.clientHeight;
    const laneWidth = roadWidth / 3;
    laneCenters = [0, 1, 2].map(i => laneWidth * i + laneWidth / 2);
    setPlayerLane(currentLane, false);
  }

  function setPlayerLane(lane, animate) {
    currentLane = lane;
    const x = laneCenters[lane] - PLAYER_WIDTH / 2;
    if (!animate) {
      playerEl.style.transition = 'none';
      playerEl.style.left = x + 'px';
      // force reflow then restore transition
      void playerEl.offsetWidth;
      playerEl.style.transition = '';
    } else {
      playerEl.style.left = x + 'px';
    }
  }

  /* ============================================================
     INPUT: swipe + keyboard
  ============================================================ */
  let touchStartX = null;
  let touchStartY = null;

  touchLayer.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }, { passive: true });

  touchLayer.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) moveLane(-1); else moveLane(1);
    }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') moveLane(-1);
    else if (e.key === 'ArrowRight') moveLane(1);
  });

  function moveLane(dir) {
    if (!running) return;
    const next = Math.min(2, Math.max(0, currentLane + dir));
    if (next !== currentLane) setPlayerLane(next, true);
  }

  /* ============================================================
     SPAWNING
  ============================================================ */
  function spawnWave() {
    // Choose how many lanes get an item this wave (never all 3, so a path is always open)
    const laneOrder = [0, 1, 2].sort(() => Math.random() - 0.5);
    const laneCount = Math.random() < 0.65 ? 1 : 2;
    const chosenLanes = laneOrder.slice(0, laneCount);

    chosenLanes.forEach((lane) => {
      const isCoin = Math.random() < 0.62;
      spawnItem(lane, isCoin ? 'coin' : 'obstacle');
    });
  }

  function spawnItem(lane, type) {
    const el = document.createElement('div');
    let width, height, obstacleKind = null;

    if (type === 'coin') {
      el.className = 'coin';
      width = 34; height = 34;
    } else {
      const kinds = ['obstacle-box', 'obstacle-rock', 'obstacle-cone'];
      obstacleKind = kinds[Math.floor(Math.random() * kinds.length)];
      el.className = 'obstacle ' + obstacleKind;
      width = obstacleKind === 'obstacle-cone' ? 34 : 44;
      height = obstacleKind === 'obstacle-cone' ? 42 : (obstacleKind === 'obstacle-box' ? 40 : 36);
    }

    const x = laneCenters[lane] - width / 2;
    el.style.left = x + 'px';
    el.style.top = '-60px';
    roadEl.appendChild(el);

    items.push({
      el, type, lane, y: -60, width, height, handled: false
    });
  }

  function spawnCollectEffect(lane, y) {
    const burst = document.createElement('div');
    burst.className = 'coin-burst';
    burst.style.left = (laneCenters[lane] - 20) + 'px';
    burst.style.top = (y - 3) + 'px';
    roadEl.appendChild(burst);
    setTimeout(() => burst.remove(), 420);
  }

  /* ============================================================
     GAME LOOP
  ============================================================ */
  function startGame() {
    ensureAudio();
    gameOverScreen.classList.add('hidden');
    startScreen.classList.add('hidden');

    // reset state
    items.forEach(it => it.el.remove());
    items.length = 0;
    score = 0;
    speed = START_SPEED;
    spawnInterval = 1300;
    spawnTimer = 0;
    elapsed = 0;
    currentLane = 1;
    updateScoreDisplay();
    computeLayout();
    setPlayerLane(1, false);

    running = true;
    gameStarted = true;
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function loop(now) {
    if (!running) return;
    let dt = now - lastFrameTime;
    if (dt > 60) dt = 60; // clamp to avoid big jumps (tab switch etc.)
    lastFrameTime = now;
    elapsed += dt;

    // difficulty ramp
    speed = Math.min(MAX_SPEED, START_SPEED + (elapsed / 1000) * SPEED_RAMP);
    spawnInterval = Math.max(MIN_SPAWN_INTERVAL, 1300 - (elapsed / 1000) * 14);

    spawnTimer += dt;
    if (spawnTimer >= spawnInterval) {
      spawnTimer = 0;
      spawnWave();
    }

    updateItems(dt);

    rafId = requestAnimationFrame(loop);
  }

  function updateItems(dt) {
    const dy = speed * (dt / 1000);
    const playerBottom = roadHeight - roadHeight * 0.16;
    const playerTop = playerBottom - PLAYER_HEIGHT;
    // shrink hit box slightly for fairer collisions
    const hitTop = playerTop + 14;
    const hitBottom = playerBottom - 6;

    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += dy;
      it.el.style.top = it.y + 'px';

      const itemBottom = it.y + it.height;
      const itemTop = it.y;

      if (!it.handled && it.lane === currentLane) {
        const overlap = itemBottom > hitTop && itemTop < hitBottom;
        if (overlap) {
          it.handled = true;
          if (it.type === 'coin') {
            collectCoin(it);
          } else {
            triggerGameOver();
            return;
          }
        }
      }

      if (it.y > roadHeight + 20) {
        it.el.remove();
        items.splice(i, 1);
      }
    }
  }

  function collectCoin(it) {
    it.el.remove();
    const idx = items.indexOf(it);
    if (idx !== -1) items.splice(idx, 1);
    score += 10;
    updateScoreDisplay();
    spawnCollectEffect(it.lane, it.y);
    playCoinSound();
  }

  function updateScoreDisplay() {
    scoreEl.textContent = score;
  }

  function triggerGameOver() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    playCrashSound();

    let isNewBest = false;
    if (score > highScore) {
      highScore = score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
      isNewBest = true;
    }

    highscoreEl.textContent = highScore;
    finalScoreEl.textContent = score;
    finalHighEl.textContent = highScore;
    newBestEl.classList.toggle('hidden', !isNewBest);

    gameOverScreen.classList.remove('hidden');
  }

  /* ============================================================
     EVENTS
  ============================================================ */
  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  window.addEventListener('resize', () => {
    if (gameStarted) computeLayout();
  });

  /* ============================================================
     INIT
  ============================================================ */
  buildStars();
  computeLayout();
})();
