import * as THREE from 'three';
import './style.css';
import { AudioEngine, VOICE_URLS } from './audio/audioEngine';
import { COMMANDS, COMMAND_COOLDOWN, COMMAND_IDS, DIFFICULTIES, DOORS, EXIT_POINT, FURNITURE_RECTS, GUARD_RADIUS, PLAYER_RADIUS, TIME_LIMIT, WALKABLE_RECTS } from './core/config';
import type { CommandId, DifficultyId, DoorId, PlayerInput, Point } from './core/config';
import { dangerWindow, pauseAfterBackground } from './core/lifecycle';
import { appendRecord, createLocalStore, formatRecord, formatSummary, readRecords } from './core/gameLog';
import type { RoundRecord } from './core/gameLog';
import { distance } from './core/map';
import { RoundsGame } from './core/state';
import type { GameEvent, Phase } from './core/state';
import { FirstPersonCamera } from './render/camera';
import { HospitalRenderer } from './render/scene';
import { SPRINT_EXHAUSTED_BELOW, isTap, sprintEngaged, stickAxes, touchControlsVisible } from './render/touch';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mountShop, paidReturnNotice } from './ui/shop';
import { levelById, skinById } from './core/economy';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少页面元素：${id}`);
  return found as T;
}

function showFatal(message: string): void {
  element('fatal-message').textContent = message;
  element('fatal').hidden = false;
}

try {
  boot();
} catch (error) {
  showFatal(error instanceof Error ? error.message : '未知启动错误');
}

function boot(): void {
  const debug = new URLSearchParams(location.search).get('debug') === '1';
  const game = new RoundsGame();
  const audio = new AudioEngine();
  const hospital = new HospitalRenderer();
  const follow = new FirstPersonCamera();
  // 第一人称：玩家模型不再出镜，只保留值班员。
  hospital.playerRig.visible = false;
  (window as any).__ROUNDS_GAME__ = game;
  (window as any).__ROUNDS_FOLLOW__ = follow;
  (window as any).__ROUNDS_HOSPITAL__ = hospital;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '医院走廊，WASD 移动，按住鼠标右键转动镜头');
  element('scene').appendChild(canvas);
  // 环境反射：室内低强度，让金属、玻璃与地面有真实的高光层次，烘焙一次后零运行时成本。
  const pmrem = new THREE.PMREMGenerator(renderer);
  hospital.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  hospital.scene.environmentIntensity = 0.3;
  pmrem.dispose();

  const timer = element('timer');
  const timerLabel = element('timer-label');
  const objective = element('objective');
  const status = element('status');
  const overlay = element('overlay');
  const title = element('overlay-title');
  const copy = element('overlay-copy');
  const kicker = element('overlay-kicker');
  const help = element('start-help');
  const footnote = element('overlay-footnote');
  const shiftLog = element('shift-log');
  const primary = element<HTMLButtonElement>('primary');
  const pause = element<HTMLButtonElement>('pause');
  const mute = element<HTMLButtonElement>('mute');
  const stamina = element('stamina');
  const staminaFill = element('stamina-fill');
  const staminaLabel = element('stamina-label');
  const staminaHint = element('stamina-hint');
  const toast = element('toast');
  const effectPanel = element('effect-panel');
  const effectName = element('effect-name');
  const effectTime = element('effect-time');
  const effectFill = element('effect-fill');
  const danger = element('danger');
  const threatPointer = element('threat-pointer');
  const minimap = element<HTMLCanvasElement>('minimap');
  const mapContext = minimap.getContext('2d');
  const mapNote = element('map-note');
  const corridorName = element('corridor-name');
  const commandButtons = Object.fromEntries(COMMAND_IDS.map(id => [id, element<HTMLButtonElement>(`command-${id}`)])) as Record<CommandId, HTMLButtonElement>;
  const debugState = element('debug-state');
  const debugButtons = ['debug-a', 'debug-b', 'debug-time', 'debug-exit'].map(id => element<HTMLButtonElement>(id));
  element('debug-panel').hidden = !debug;
  const escapeFlare = element('escape-flare');
  const escapingCutscene = {
    active: false,
    elapsed: 0,
    duration: 1.6,
  };

  function startEscapingCutscene(): void {
    escapingCutscene.active = true;
    escapingCutscene.elapsed = 0;
    overlay.hidden = true;
    audio.playDoorOpenSound();
    audio.chime();
    notice('安全门推开，迎向晨光逃离！');
  }
  const mapPanel = document.querySelector<HTMLElement>('.map-panel');
  if (mapPanel) mapPanel.hidden = debug;

  // 触控层：粗指针设备才显示摇杆与按钮，桌面鼠标完全不受影响。
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const touchLayer = element<HTMLElement>('touch-controls');
  const touchStick = element<HTMLElement>('touch-stick');
  const touchThumb = element<HTMLElement>('touch-thumb');
  const touchSprint = element<HTMLButtonElement>('touch-sprint');
  const touchPause = element<HTMLButtonElement>('touch-pause');
  // 验收观测用：输入管道的实时镜像，?debug=1 下经 __ROUNDS_DEBUG__.input() 读取。
  const inputMirror = { get dragging() { return dragging; }, keysSeen: () => [...keys] };
  const hasTouch = touchControlsVisible(coarsePointer ? 'coarse' : 'fine') || navigator.maxTouchPoints > 0;
  touchLayer.hidden = !hasTouch;
  document.body.dataset.touch = String(hasTouch);
  element('touch-help').hidden = !hasTouch;
  if (hasTouch) help.querySelectorAll<HTMLElement>(':scope > div:not(#touch-help)').forEach(node => node.classList.add('keyboard-only'));
  const touch = { forward: 0, right: 0, sprint: false, stickId: -1, originX: 0, originY: 0, dragId: -1, dragX: 0, dragY: 0, dragStartedAt: 0, dragMoved: 0 };

  const keys = new Set<string>();
  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let previousPhase: Phase | null = null;
  let lastFrame = performance.now();
  let toastUntil = 0;
  let dangerUntil = 0;
  let uiTime = -1;
  let fatal = false;
  let contextLost = false;
  let hiddenAt: number | null = null;
  let resumeNote = '';
  let unlockNotice: string | null = null;
  let previousGuardMode = game.guard.mode;
  let audioWarned = false;
  let focusWarned = false;
  let lastKnownHidden = document.hidden;

  function clearInput(): void {
    keys.clear();
    dragging = false;
    touch.forward = 0;
    touch.right = 0;
    touch.sprint = false;
    touch.stickId = -1;
    touch.dragId = -1;
    touchThumb.style.transform = '';
    touchSprint.setAttribute('aria-pressed', 'false');
  }

  function notice(text: string, alert = false): void {
    toast.textContent = text;
    toast.hidden = false;
    // 追逐警报直接由红色警示条承载全文，不再另弹一枚与正文叠压的“被发现了”胶囊。
    toast.classList.toggle('alert', alert);
    // 使用游玩时钟，暂停时不偷偷让提示消失。
    toastUntil = game.elapsed + 3.2;
  }

  /** 新建一局必须由玩家手势触发；若检测到后台抖动导致的暂停，不擅自开局。 */
  function beginRound(): void {
    clearInput();
    escapingCutscene.active = false;
    escapingCutscene.elapsed = 0;
    escapeFlare.style.opacity = '0';
    hospital.resetExitDoor();
    resumeNote = '';
    unlockNotice = null;
    game.start();
    audio.startRound(); // 必须直接在用户手势内 resume AudioContext
    follow.reset();
    toast.hidden = true;
    toast.classList.remove('alert');
    toastUntil = 0;
    dangerUntil = 0;
    uiTime = -1;
    previousGuardMode = game.guard.mode;
    lastFrame = performance.now();
    canvas.focus({ preventScroll: true });
    updateUI();
  }

  function pauseGame(): void {
    clearInput();
    game.pause();
    audio.setPaused(true);
    updateUI();
  }

  function resumeGame(): void {
    clearInput();
    resumeNote = '';
    if (document.hidden) {
      resumeNote = '页面仍在后台，回到前台后再继续';
      updateUI();
      return;
    }
    game.resume();
    audio.setPaused(false);
    lastFrame = performance.now();
    canvas.focus({ preventScroll: true });
    updateUI();
  }

  function togglePause(): void {
    if (game.phase === 'playing') pauseGame();
    else if (game.phase === 'paused') resumeGame();
  }

  function toggleDoor(id: DoorId): void {
    if (!debug || game.phase !== 'playing') return;
    const close = game.map.closedDoor !== id;
    if (game.setDoor(id, close) && !close) notice(`防火门 ${id} 已打开，路线恢复`);
  }

  function fastForward(unlock: boolean): void {
    if (!debug || game.phase !== 'playing') return;
    game.debugSetRemaining(unlock ? 0 : 3);
    if (unlock) {
      audio.chime();
      audio.voice('unlocked');
      notice('验收：安全门已通电，仍须亲自到门前');
    } else notice('验收：剩余 3 秒，不会自动获胜');
  }

  function activateCommand(id: CommandId): void {
    game.useCommand(id);
    for (const event of game.drainEvents()) handleEvent(event);
    uiTime = -1;
    updateUI();
    canvas.focus({ preventScroll: true });
  }

  // ── 值班日志：跨会话的逐局记录 ─────────────────────────────
  const logStore = createLocalStore();
  let logRecords: RoundRecord[] = readRecords(logStore);

  // ── 难度：三档层层进阶，通关解锁下一档 ─────────────────────
  const UNLOCK_KEY = 'rounds-difficulty-v1';
  const nextOf: Record<DifficultyId, DifficultyId | null> = { intern: 'standard', standard: 'graveyard', graveyard: null };
  const loadUnlocked = (): DifficultyId[] => {
    try {
      const raw = window.localStorage.getItem(UNLOCK_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(parsed)) return ['intern', 'standard'];
      const valid = parsed.filter((id): id is DifficultyId => id === 'intern' || id === 'standard' || id === 'graveyard');
      return valid.length > 0 ? valid : ['intern', 'standard'];
    } catch {
      return ['intern', 'standard'];
    }
  };
  let unlockedDifficulties = loadUnlocked();
  let selectedDifficulty: DifficultyId = unlockedDifficulties.includes('standard') ? 'standard' : 'intern';

  const difficultyCards = [...document.querySelectorAll<HTMLButtonElement>('.difficulty-card')];
  function renderDifficultyCards(): void {
    const badge = document.getElementById('diff-current-badge');
    if (badge) badge.textContent = DIFFICULTIES[selectedDifficulty].name;
    for (const card of difficultyCards) {
      const id = card.dataset.difficulty as DifficultyId;
      card.dataset.selected = String(id === selectedDifficulty);
      const locked = !unlockedDifficulties.includes(id);
      if (locked) card.dataset.locked = 'true';
      else delete card.dataset.locked;
      card.disabled = locked || game.phase === 'playing' || game.phase === 'paused';
    }
  }
  for (const card of difficultyCards) {
    card.addEventListener('click', () => {
      const id = card.dataset.difficulty as DifficultyId;
      if (!unlockedDifficulties.includes(id) || game.phase === 'playing' || game.phase === 'paused') return;
      selectedDifficulty = id;
      game.setDifficulty(id);
      renderDifficultyCards();
      card.blur();
    });
  }

  /** 通关当前难度：解锁下一档并持久化；返回解锁提示文案（无解锁返回 null）。 */
  function clearDifficulty(id: DifficultyId): string | null {
    const next = nextOf[id];
    if (!next || unlockedDifficulties.includes(next)) return null;
    unlockedDifficulties = [...unlockedDifficulties, next];
    try { window.localStorage.setItem(UNLOCK_KEY, JSON.stringify(unlockedDifficulties)); } catch { /* 解锁进度仅本会话 */ }
    return `已解锁：${DIFFICULTIES[next].name}`;
  }

  function recordRound(result: 'won' | 'lost'): void {
    const updated = appendRecord(logRecords, result, game.elapsed, game.commandsUsed, game.difficulty.id);
    logRecords = updated.records;
    try { logStore?.save(logRecords); } catch { /* 存档失败只影响跨会话，不影响本局 */ }
  }

  function renderShiftLog(phase: Phase): void {
    if (logRecords.length === 0) {
      shiftLog.hidden = true;
      return;
    }
    const summary = formatSummary(logRecords);
    if (phase === 'start') {
      const last = logRecords[logRecords.length - 1];
      shiftLog.hidden = false;
      shiftLog.innerHTML = `<span class="log-title">值班日志</span><br>${summary}<br>上次：${formatRecord(last)}`;
      return;
    }
    if (phase === 'won' || phase === 'lost') {
      const recent = logRecords.slice(-3).reverse();
      const items = recent
        .map(record => `<li class="${record.result}"><span class="mono">#${record.index}</span><span>${formatRecord(record).replace(/^第 \d+ 局 · /, '')}</span></li>`)
        .join('');
      shiftLog.hidden = false;
      shiftLog.innerHTML = `<span class="log-title">值班日志 · ${summary}</span><ul>${items}</ul>`;
      return;
    }
    shiftLog.hidden = true;
  }

  function handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'started': break; // beginRound 已在用户手势内启动声音
      case 'warning30': audio.voice('warning30'); break;
      case 'warning10': audio.voice('warning10'); break;
      case 'exitUnlocked':
        audio.chime();
        audio.voice('unlocked');
        notice('安全门已通电：沿东侧绿灯到门前逃生');
        break;
      case 'doorClosed':
        audio.doorSound();
        audio.voice('door');
        notice(`防火门 ${event.door} 已关闭，玩家和值班员都需要绕行`);
        break;
      case 'doorOpened':
        audio.doorOpenSound();
        notice(`防火门 ${event.door} 已打开，路线恢复`);
        break;
      case 'doorBlocked': notice('无法落门：门框被占用，或另一扇门仍关闭'); break;
      case 'commandStarted':
        notice(event.message ?? '指令已发动');
        if (event.command === 'broadcast') {
          audio.paDing();
          audio.voice('ward');
        }
        else if (event.command === 'lights') audio.lightSwitch();
        break;
      case 'commandEnded':
        if (event.command === 'lights') notice('开灯结束 · 视距恢复，注意走廊拐角');
        else if (event.command === 'broadcast') notice(game.guard.broadcastInterrupted ? '广播未能继续引开值班员，保持距离' : '广播结束 · 值班员开始警觉搜索');
        break;
      case 'commandRejected':
        notice(event.message ?? '当前无法发动这条指令');
        if (event.command) {
          commandButtons[event.command].classList.remove('denied');
          void commandButtons[event.command].offsetWidth;
          commandButtons[event.command].classList.add('denied');
        }
        break;
      case 'guardChanged':
        notice(event.message ?? '巡查状态改变', game.guard.mode === 'chase');
        dangerUntil = dangerWindow(previousGuardMode, game.guard.mode, game.elapsed, dangerUntil);
        if (game.guard.mode === 'chase' && previousGuardMode !== 'chase') audio.alert();
        previousGuardMode = game.guard.mode;
        break;
      case 'caught':
        clearInput();
        audio.stopRound();
        audio.voice('caught');
        recordRound('lost');
        break;
      case 'won': {
        clearInput();
        audio.stopRound();
        recordRound('won');
        unlockNotice = clearDifficulty(game.difficulty.id);
        startEscapingCutscene();
        break;
      }
    }
    // 触控设备没有 R 键：结算后给一个屏上「再来一次」。
    if (hasTouch && (event.type === 'caught' || event.type === 'won')) {
      touchPause.textContent = '再来';
      touchPause.setAttribute('aria-label', '再来一次');
    }
  }

  function corridor(point: Point): string {
    if (point.z < 6.4) return '北走廊';
    if (point.z > 15.6) return '南走廊';
    return point.x < 15 ? '西走廊' : '东走廊';
  }

  function drawMap(): void {
    const ctx = mapContext;
    if (!ctx) return;
    const s = 6, x0 = 10, z0 = 7;
    ctx.clearRect(0, 0, 200, 146);
    ctx.fillStyle = '#a9b6a4'; ctx.fillRect(0, 0, 200, 146);
    for (const rect of WALKABLE_RECTS) {
      ctx.fillStyle = '#f0f4e9';
      ctx.fillRect(x0+rect.minX*s,z0+rect.minZ*s,(rect.maxX-rect.minX)*s,(rect.maxZ-rect.minZ)*s);
    }
    ctx.fillStyle = '#93a48d';
    for (const rect of FURNITURE_RECTS) ctx.fillRect(x0+rect.minX*s,z0+rect.minZ*s,(rect.maxX-rect.minX)*s,(rect.maxZ-rect.minZ)*s);
    if (game.map.closedDoor) {
      const door = DOORS[game.map.closedDoor]; ctx.strokeStyle = '#a96255'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0+15*s,z0+door.minZ*s); ctx.lineTo(x0+15*s,z0+door.maxZ*s); ctx.stroke();
    }
    ctx.fillStyle = game.exitUnlocked ? '#2f9257' : '#a06b45';
    ctx.fillRect(x0+EXIT_POINT.x*s-2,z0+EXIT_POINT.z*s-5,4,10);
    if (game.exitUnlocked) {
      ctx.fillStyle = '#eaf6ec';
      ctx.font = 'bold 7px sans-serif';
      ctx.fillText('出', x0+EXIT_POINT.x*s-3.5, z0+EXIT_POINT.z*s+2.5);
    }
    const p = game.player.position;
    ctx.fillStyle = '#2d7967'; ctx.beginPath(); ctx.arc(x0+p.x*s,z0+p.z*s,4.2,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#2d7967'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0+p.x*s,z0+p.z*s); ctx.lineTo(x0+(p.x+Math.cos(follow.yaw)*1.2)*s,z0+(p.z+Math.sin(follow.yaw)*1.2)*s); ctx.stroke();
    // 搜索状态：黄圈标出值班员的搜索中心——玩家知道他正在翻哪里，而不是实时坐标。
    if (game.guard.mode === 'search' || game.guard.mode === 'broadcast') {
      const marker = game.guard.targetPoint ?? game.guard.position;
      ctx.strokeStyle = '#b98a2f'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x0+marker.x*s, z0+marker.z*s, 6.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#b98a2f'; ctx.font = 'bold 7px sans-serif';
      ctx.fillText('搜', x0+marker.x*s-3.5, z0+marker.z*s-8);
    }
    // 广播诱导：目标病房绿框脉动，一眼看出他被引去哪间。
    if (game.activeEffect?.id === 'broadcast' && game.activeEffect.target) {
      const t = game.activeEffect.target;
      ctx.strokeStyle = '#2f9257'; ctx.lineWidth = 1.8;
      ctx.strokeRect(x0+t.x*s-7, z0+t.z*s-7, 14, 14);
    }
    // 值班员实时位置：开灯定位、近距离目视或正在追逐时可见。
    if (game.lightsOn || game.guard.mode === 'chase' || (distance(p,game.guard.position)<10 && game.map.hasLineOfSight(p,game.guard.position))) {
      ctx.fillStyle = '#a45b4c'; ctx.beginPath(); ctx.arc(x0+game.guard.position.x*s,z0+game.guard.position.z*s,4.1,0,Math.PI*2); ctx.fill();
    }
    corridorName.textContent = corridor(p);
    mapNote.textContent = game.exitUnlocked ? '东侧安全门已通电 · 绿灯为逃生路线' : game.lightsOn ? `开灯定位：值班员在${corridor(game.guard.position)}` : '绿点：你 · 东侧：安全门';
  }

  /** 追逐时画面外看不到威胁来源：一枚低强度红色箭头绕屏幕中心指向值班员方位，其余状态隐藏。 */
  function updateThreatPointer(): void {
    const chasing = game.phase === 'playing' && game.guard.mode === 'chase';
    if (!chasing) {
      if (!threatPointer.hidden) threatPointer.hidden = true;
      return;
    }
    const dx = game.guard.position.x - game.player.position.x;
    const dz = game.guard.position.z - game.player.position.z;
    const bearing = Math.atan2(dz, dx) - follow.yaw;
    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.34;
    const x = Math.sin(bearing) * radius;
    const y = -Math.cos(bearing) * radius;
    threatPointer.hidden = false;
    threatPointer.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px)) rotate(${(bearing * 180 / Math.PI).toFixed(1)}deg)`;
  }

  function updateUI(): void {
    if (previousPhase === game.phase && game.elapsed >= uiTime && game.elapsed - uiTime < 0.07) return;
    uiTime = game.elapsed;
    timerLabel.textContent = game.exitUnlocked ? '东侧安全门 · 已通电' : '安全门通电';
    const time = game.exitUnlocked ? '逃生' : `${Math.ceil(game.remaining)}<span>s</span>`;
    if (timer.innerHTML !== time) timer.innerHTML = time;
    objective.textContent = game.exitUnlocked ? '东侧安全门已通电 · 立刻前往门口逃生' : '躲开值班员，等安全门通电';
    status.textContent = game.lightsOn ? `开灯定位：值班员在${corridor(game.guard.position)} · 视距 12m` : {
      patrol: '巡查中 · 走路安静，奔跑会被听见',
      chase: '被发现！转进病房、药房或屏风后，或用 2 封锁追捕路线',
      search: '正在搜索 · 先躲开视线，再用 3 广播引开',
      broadcast: `广播核查中 · 值班员正赶往${(game.activeEffect?.target?.x ?? 15) > 15 ? '东' : '西'}侧病房`,
    }[game.guard.mode];
    danger.hidden = game.elapsed >= dangerUntil || game.phase !== 'playing';
    danger.dataset.on = String(!danger.hidden);
    const audioIssue = audio.snapshot().issue;
    if (audioIssue && !audioWarned && game.phase === 'playing') {
      audioWarned = true;
      notice(`${audioIssue}。游戏可以继续，可用右上角按钮静音`);
    }
    // 键盘操作需要页面焦点；点过画布却没焦点时，给一次可读提示而不是让玩家以为坏了。
    if (game.phase === 'playing' && !focusWarned && !document.hasFocus()) {
      focusWarned = true;
      notice('键盘没有聚焦到游戏：点一下画面即可继续用 WASD');
    }
    for (const id of COMMAND_IDS) {
      const button = commandButtons[id];
      const state = game.commandStatus(id);
      button.disabled = game.phase !== 'playing' || !!game.activeEffect || state.cooldown > 0;
      button.setAttribute('aria-disabled', String(!state.available));
      const label = state.reason || '可用';
      const status = button.querySelector('.command-status')!;
      if (status.textContent !== label) status.textContent = label;
      const progress = Math.round((game.activeEffect?.id === id ? game.activeEffect.remaining / COMMANDS[id].duration : state.cooldown / COMMAND_COOLDOWN) * 50) / 50;
      if (button.dataset.progress !== String(progress)) {
        button.dataset.progress = String(progress);
        button.style.setProperty('--progress', `${progress * 100}%`);
      }
    }
    const effect = game.activeEffect;
    effectPanel.hidden = !effect;
    if (effect) {
      effectName.textContent = `${COMMANDS[effect.id].name}${effect.door ? ` · 门 ${effect.door}` : ''}`;
      effectTime.textContent = `${effect.remaining.toFixed(1)}s`;
      const fraction = Math.max(0, Math.min(1, Math.round((effect.remaining / COMMANDS[effect.id].duration) * 20) / 20));
      if (effectFill.dataset.steps !== String(fraction)) {
        effectFill.dataset.steps = String(fraction);
        effectFill.style.transform = `scaleX(${fraction})`;
      }
    }
    drawMap();
    const percent = Math.round(game.player.stamina * 100);
    // 只在格数变化时写 DOM：每帧写 transform 会让自动化「元素稳定」判定超时。
    const staminaTenths = Math.round(game.player.stamina * 20);
    if (staminaFill.dataset.steps !== String(staminaTenths)) {
      staminaFill.dataset.steps = String(staminaTenths);
      staminaFill.style.transform = `scaleX(${staminaTenths / 20})`;
    }
    stamina.setAttribute('aria-valuenow', String(percent));
    staminaLabel.textContent = `${percent}%`;
    staminaHint.textContent = game.player.stamina < 0.03 ? '体力耗尽 · 松开 Shift 恢复' : '按住 Shift 奔跑 · 松开恢复';
    // 触屏没有独立体力条：跑按钮外圈即体力环；耗尽时自动弹起开关，不让按钮谎称在奔跑。
    if (hasTouch) {
      // 只在「按下 → 耗尽」这一沿写一次；空闲时每秒十余次重复 setAttribute 会打破 HUD 写入节流纪律。
      if (touch.sprint && !sprintEngaged(true, game.player.stamina)) {
        touch.sprint = false;
        touchSprint.setAttribute('aria-pressed', 'false');
      }
      const sprintSteps = Math.round(game.player.stamina * 20);
      if (touchSprint.dataset.steps !== String(sprintSteps)) {
        touchSprint.dataset.steps = String(sprintSteps);
        touchSprint.style.setProperty('--stamina', String(sprintSteps / 20));
      }
      touchSprint.classList.toggle('exhausted', game.player.stamina < SPRINT_EXHAUSTED_BELOW);
    }
    if (!toast.hidden && game.phase === 'playing' && game.elapsed >= toastUntil) toast.hidden = true;

    if (debug) {
      debugState.textContent = `${game.phase} / ${game.remaining.toFixed(2)}s\n玩家 (${game.player.position.x.toFixed(2)}, ${game.player.position.z.toFixed(2)})\n值班员 (${game.guard.position.x.toFixed(2)}, ${game.guard.position.z.toFixed(2)})\n视角 yaw ${follow.yaw.toFixed(2)} pitch ${follow.pitch.toFixed(2)}\n门：${game.map.closedDoor ?? '全开'} / 语音 ${audio.snapshot().decodedVoices}/8`;
      for (const button of debugButtons) button.disabled = game.phase !== 'playing';
    }
    if (previousPhase === game.phase && !escapingCutscene.active) return;
    previousPhase = game.phase;
    document.body.dataset.phase = game.phase;
    overlay.hidden = game.phase === 'playing' || escapingCutscene.active;
    renderShiftLog(game.phase);
    renderDifficultyCards();
    pause.disabled = game.phase !== 'playing' && game.phase !== 'paused';
    pause.innerHTML = game.phase === 'paused' ? '继续 <kbd>Esc</kbd>' : '暂停 <kbd>Esc</kbd>';
    help.hidden = game.phase !== 'start';
    if (game.phase === 'paused') {
      kicker.textContent = '时钟已冻结';
      title.textContent = '值班暂停。';
      copy.innerHTML = `<p class="result-evaluation">${resumeNote || '准备就绪后，点击继续返回走廊。'}</p>`;
      primary.innerHTML = '<span>继续值班</span><span class="arrow-icon" aria-hidden="true">→</span>';
      footnote.textContent = '';
    } else if (game.phase === 'won') {
      kicker.textContent = 'ROUNDS · 撤离成功';
      title.textContent = '你走出了医院。';
      const verdict = game.commandsUsed === 0
        ? '零指令硬闯 · 身手干净利落'
        : game.commandsUsed === 1
        ? '一击改写路线 · 成功突围'
        : '掌控全院规则 · 成功脱身';
      const diffName = game.difficulty.id === 'intern' ? '见习' : game.difficulty.id === 'standard' ? '标准' : '高危';
      const unlockPill = unlockNotice
        ? `<div class="stat-pill"><span class="stat-label">解锁</span><strong class="stat-value">${unlockNotice.replace('已解锁：', '')}</strong></div>`
        : '';
      copy.innerHTML = `
        <div class="result-stats">
          <div class="stat-pill"><span class="stat-label">用时</span><strong class="stat-value">45.0s</strong></div>
          <div class="stat-pill"><span class="stat-label">指令</span><strong class="stat-value">${game.commandsUsed}次</strong></div>
          <div class="stat-pill"><span class="stat-label">难度</span><strong class="stat-value">${diffName}</strong></div>${unlockPill}
        </div>
        <p class="result-evaluation">${verdict}</p>
      `;
      primary.innerHTML = '<span>再来一次</span><span class="arrow-icon" aria-hidden="true">→</span>';
      footnote.textContent = '';
    } else if (game.phase === 'lost') {
      kicker.textContent = 'ROUNDS · 巡查中断';
      title.textContent = '被值班员抓住。';
      const held = Math.floor(game.elapsed);
      const remainingSec = Math.max(0, Math.floor(TIME_LIMIT - held));
      const tip = held < 15 ? '先看清巡查路线再行动' : '通电前切忌奔跑 · 留好体力';
      copy.innerHTML = `
        <div class="result-stats">
          <div class="stat-pill"><span class="stat-label">坚持</span><strong class="stat-value">${held}s</strong></div>
          <div class="stat-pill"><span class="stat-label">距通电</span><strong class="stat-value">${remainingSec}s</strong></div>
          <div class="stat-pill"><span class="stat-label">区域</span><strong class="stat-value">${corridor(game.player.position)}</strong></div>
        </div>
        <p class="result-evaluation">${tip}</p>
      `;
      primary.innerHTML = '<span>重新挑战</span><span class="arrow-icon" aria-hidden="true">→</span>';
      footnote.textContent = '';
    }
  }

  const press = (button: HTMLButtonElement, handler: () => void): void => {
    button.addEventListener('click', () => {
      handler();
      button.blur(); // 释放焦点：避免之后按 Space / Enter 触发浏览器原生 click 误操作
    });
  };
  press(primary, () => {
    if (game.phase === 'paused') resumeGame();
    else beginRound();
  });
  press(pause, togglePause);
  for (const id of COMMAND_IDS) {
    press(commandButtons[id], () => activateCommand(id));
    commandButtons[id].addEventListener('animationend', () => commandButtons[id].classList.remove('denied'));
  }
  press(mute, () => {
    const muted = audio.toggleMute();
    mute.innerHTML = muted ? '<kbd>M</kbd> 静音' : '<kbd>M</kbd> 声音';
    mute.setAttribute('aria-pressed', String(muted));
  });

  // 手机扫码弹窗与路演 PPT 交互
  const qrModal = document.getElementById('qr-modal');
  const pitchModal = document.getElementById('pitch-modal');
  const pitchIframe = document.getElementById('pitch-iframe') as HTMLIFrameElement | null;
  const btnQr = document.getElementById('btn-qr') as HTMLButtonElement | null;
  const btnPitch = document.getElementById('btn-pitch') as HTMLButtonElement | null;
  const briefingQr = document.getElementById('briefing-qr') as HTMLButtonElement | null;
  const briefingPitch = document.getElementById('briefing-pitch') as HTMLButtonElement | null;

  function openQrModal(): void {
    if (qrModal) qrModal.hidden = false;
  }
  function openPitchModal(): void {
    if (pitchModal) {
      pitchModal.hidden = false;
      if (pitchIframe && (!pitchIframe.src || pitchIframe.src === 'about:blank' || pitchIframe.src.endsWith('about:blank'))) {
        pitchIframe.src = '/PPT_20261031_查房_3D心理微恐解密游戏路演_本地演示.html';
      }
    }
  }
  function closeAllModals(): void {
    if (qrModal) qrModal.hidden = true;
    if (pitchModal) pitchModal.hidden = true;
  }

  if (btnQr) press(btnQr, openQrModal);
  if (briefingQr) press(briefingQr, openQrModal);
  if (btnPitch) press(btnPitch, openPitchModal);
  if (briefingPitch) press(briefingPitch, openPitchModal);

  // 全屏切换（支持桌面与手机浏览器全屏沉浸视界）
  const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement | null;
  const touchFullscreen = document.getElementById('touch-fullscreen') as HTMLButtonElement | null;
  function toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
  function updateFsText(): void {
    const isFs = !!document.fullscreenElement;
    if (btnFullscreen) btnFullscreen.textContent = isFs ? '窗口' : '全屏';
    if (touchFullscreen) touchFullscreen.textContent = isFs ? '窗口' : '全屏';
  }
  if (btnFullscreen) press(btnFullscreen, toggleFullscreen);
  if (touchFullscreen) press(touchFullscreen, toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFsText);

  document.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', closeAllModals);
  });

  if (debug) {
    press(debugButtons[0], () => toggleDoor('A'));
    press(debugButtons[1], () => toggleDoor('B'));
    press(debugButtons[2], () => fastForward(false));
    press(debugButtons[3], () => fastForward(true));
  }

  window.addEventListener('keydown', event => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault();
      if (game.phase === 'playing') keys.add(event.code);
      return;
    }
    if (event.repeat) return;
    if (event.code === 'Escape') {
      if ((qrModal && !qrModal.hidden) || (pitchModal && !pitchModal.hidden)) {
        event.preventDefault();
        closeAllModals();
        return;
      }
      event.preventDefault();
      togglePause();
    }
    else if (event.code === 'KeyR' && (game.phase === 'won' || game.phase === 'lost')) beginRound();
    else if (['Digit1', 'Digit2', 'Digit3'].includes(event.code) && game.phase === 'playing') activateCommand(COMMAND_IDS[Number(event.code.slice(-1)) - 1]);
    else if (debug && ['F2', 'F3', 'F4', 'F5'].includes(event.code)) {
      event.preventDefault();
      if (event.code === 'F2') toggleDoor('A');
      else if (event.code === 'F3') toggleDoor('B');
      else fastForward(event.code === 'F5');
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 2 || game.phase !== 'playing') return;
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    // 指针捕获只是“拖出画布仍持续转向”的增强；合成/注入事件的指针 id 可能无法捕获，失败不应中断拖动。
    try { canvas.setPointerCapture(event.pointerId); } catch { /* 无法捕获时退化为画布内拖动 */ }
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging || game.phase !== 'playing') return;
    follow.rotate((event.clientX - lastPointerX) * 0.0032);
    follow.tilt(-(event.clientY - lastPointerY) * 0.0028);
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', clearInput);
  // 触摸板：双指横滑转视角、竖滑俯仰。wheel 监听必须非被动才能 preventDefault，避免页面滚动劫持手势。
  canvas.addEventListener('wheel', event => {
    if (game.phase !== 'playing') return;
    event.preventDefault();
    const yaw = Math.max(-0.32, Math.min(0.32, event.deltaX * 0.009));
    if (yaw !== 0) follow.rotate(yaw);
    const pitch = Math.max(-0.24, Math.min(0.24, event.deltaY * 0.0028));
    if (pitch !== 0) follow.tilt(-pitch);
  }, { passive: false });
  // ── 触控输入 ──────────────────────────────────────────────
  // 左半屏拖动 = 摇杆；右半屏拖动 = 转镜头；轻触（短距离短时间）= 不产生输入，避免误触打断移动。
  touchStick.addEventListener('pointerdown', event => {
    if (game.phase !== 'playing') return;
    const box = touchStick.getBoundingClientRect();
    touch.stickId = event.pointerId;
    touch.originX = box.left + box.width / 2;
    touch.originY = box.top + box.height / 2;
    touchStick.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  touchStick.addEventListener('pointermove', event => {
    if (event.pointerId !== touch.stickId) return;
    const radius = touchStick.getBoundingClientRect().width / 2;
    const axes = stickAxes(event.clientX - touch.originX, event.clientY - touch.originY, radius);
    touch.forward = axes.forward;
    touch.right = axes.right;
    const limit = Math.max(0, radius - 27);
    const magnitude = Math.hypot(axes.right, axes.forward);
    const scale = magnitude * limit;
    touchThumb.style.transform = `translate(${axes.right * scale}px, ${-axes.forward * scale}px)`;
    event.preventDefault();
  });
  const endStick = (event: PointerEvent) => {
    if (event.pointerId !== touch.stickId) return;
    touch.stickId = -1;
    touch.forward = 0;
    touch.right = 0;
    touchThumb.style.transform = '';
  };
  touchStick.addEventListener('pointerup', endStick);
  touchStick.addEventListener('pointercancel', endStick);
  touchSprint.addEventListener('click', () => {
    touchSprint.blur();
    touch.sprint = !touch.sprint;
    touchSprint.setAttribute('aria-pressed', String(touch.sprint));
  });
  touchPause.addEventListener('click', () => {
    touchPause.blur();
    if (game.phase === 'won' || game.phase === 'lost') {
      beginRound();
      touchPause.textContent = '暂停';
      touchPause.setAttribute('aria-label', '暂停');
      return;
    }
    togglePause();
  });
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || game.phase !== 'playing') return;
    touch.dragId = event.pointerId;
    touch.dragX = event.clientX;
    touch.dragY = event.clientY;
    touch.dragStartedAt = performance.now();
    touch.dragMoved = 0;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* 同上：捕获失败不阻断触控拖动 */ }
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== touch.dragId || game.phase !== 'playing') return;
    const dx = event.clientX - touch.dragX;
    const dy = event.clientY - touch.dragY;
    if (dx === 0 && dy === 0) return;
    touch.dragX = event.clientX;
    touch.dragY = event.clientY;
    touch.dragMoved += Math.abs(dx) + Math.abs(dy);
    // 一旦判定为拖动就持续转视角；累计位移超过轻触阈值即视为拖动，不要求单帧位移足够大。
    if (touch.dragMoved > 12 || !isTap(touch.dragMoved, 0, performance.now() - touch.dragStartedAt)) {
      follow.rotate(dx * 0.004);
      follow.tilt(-dy * 0.0035);
    }
  });
  const endDrag = () => { touch.dragId = -1; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // 只相信「持续躲在后台」：回到前台时用真实时间差判定。瞬时抖动与窗口失焦都不会冻结一局。
  window.addEventListener('blur', () => { clearInput(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      clearInput();
      return;
    }
    const verdict = pauseAfterBackground(
      { playing: game.phase === 'playing', focused: document.hasFocus() },
      hiddenAt,
      performance.now(),
    );
    hiddenAt = null;
    lastKnownHidden = false;
    if (verdict === 'pause') {
      pauseGame();
      resumeNote = '你切到了后台，值班已自动暂停';
      updateUI();
    }
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    fatal = true;
    pauseGame();
    const panel = element('fatal');
    panel.dataset.kind = 'context';
    showFatal('画面渲染中断（常见于切到后台）。正在尝试自动恢复；长时间停留在此页才需要刷新。');
  });
  // 手机切后台常见上下文被系统回收又自动恢复：这里复活渲染循环，让玩家保住本局，
  // 而不是看到「请刷新」白屏丢掉整局进度。
  canvas.addEventListener('webglcontextrestored', () => {
    if (!contextLost) return;
    contextLost = false;
    fatal = false;
    const panel = element('fatal');
    panel.hidden = true;
    delete panel.dataset.kind;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
    // 开始/结算页丢上下文时并未暂停本局，不能谎称「值班暂停中」。
    notice(game.phase === 'paused' ? '画面已恢复 · 值班暂停中，确认后继续' : '画面已恢复');
  });
  window.addEventListener('error', event => {
    fatal = true;
    clearInput();
    audio.stopRound();
    showFatal(event.message || '运行中出现错误，请刷新重试。');
  });

  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight);
    follow.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();
  // 兜底：部分环境（真机旋转、分屏、无头模拟）不触发 resize 事件，
  // 每帧比对视口尺寸，变了就重设画布，避免画面被拉伸或裁切。
  let lastViewport = { w: window.innerWidth, h: window.innerHeight };
  function syncViewport(): void {
    if (window.innerWidth === lastViewport.w && window.innerHeight === lastViewport.h) return;
    lastViewport = { w: window.innerWidth, h: window.innerHeight };
    resize();
  }
  hospital.sync(game, 0);
  hospital.scene.updateMatrixWorld(true);
  follow.update(game.player.position);
  updateUI();
  game.setDifficulty(selectedDifficulty);
  renderDifficultyCards();
  document.body.dataset.ready = 'true';
  document.body.dataset.touch = String(hasTouch);

  // 战备大厅：科室与出勤人员选择
  const phaseBadge = document.querySelector<HTMLElement>('.phase-badge');
  const shopEl = document.getElementById('shop');
  if (shopEl) {
    const shop = mountShop(shopEl, {
      onSelect(levelId, skinId) {
        const level = levelById(levelId);
        const skin = skinById(skinId);
        if (!level || !skin) return;
        if (level.id !== 'ward-01') {
          game.applyLevelRules(level.rules);
        } else {
          game.setDifficulty(selectedDifficulty);
        }
        hospital.applySkin(skin, level.theme);
        if (phaseBadge) phaseBadge.textContent = `${level.ward} · ${level.name}`;
      },
      onNotice(text) { notice(text, true); },
    });
    const paidNotice = paidReturnNotice();
    if (paidNotice) notice(paidNotice);
    void shop.refresh();
  }

  if (debug) {
    const state = () => ({
      phase: game.phase, elapsed: game.elapsed, remaining: game.remaining, unlocked: game.exitUnlocked,
      player: { ...game.player.position }, guard: { ...game.guard.position }, stamina: game.player.stamina,
      door: game.map.closedDoor, yaw: follow.yaw, pitch: +follow.pitch.toFixed(3), keys: [...keys], audio: audio.snapshot(),
      guardMode: game.guard.mode, guardFacing: game.guard.facing, fov: +follow.camera.fov.toFixed(2),
      memory: { ...renderer.info.memory }, effect: game.activeEffect, commandsUsed: game.commandsUsed,
      presentation: hospital.snapshot(), camera: { x: follow.camera.position.x, y: follow.camera.position.y, z: follow.camera.position.z },
      renderedPlayer: hospital.playerPoint(), drawCalls: renderer.info.render.calls,
    });
    const controls = {
      state,
      input: inputMirror,
      voiceUrls: VOICE_URLS,
      setPlayer(point: Point) {
        if (!game.map.canOccupy(point, PLAYER_RADIUS)) throw new Error('玩家测试坐标不可通行');
        clearInput();
        game.player.position = { ...point };
      },
      setGuard(point: Point, targetIndex = 0) {
        if (!game.map.canOccupy(point, GUARD_RADIUS)) throw new Error('值班员测试坐标不可通行');
        game.guard.position = { ...point };
        game.guard.setPatrolTarget(targetIndex, game.map);
      },
      setStamina(value: number) {
        game.player.stamina = Math.max(0, Math.min(1, value));
      },
      setYaw(yaw: number) {
        follow.yaw = yaw;
      },
      forceContextLoss() { renderer.forceContextLoss(); },
      forceContextRestore() { renderer.forceContextRestore(); },
    };
    Object.assign(window, { __ROUNDS_GAME__: game, __ROUNDS_DEBUG__: controls, __ROUNDS_HOSPITAL__: hospital });
  }

  function frame(now: number): void {
    if (fatal) return;
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    syncViewport();
    const input: PlayerInput = {
      forward: Math.max(-1, Math.min(1, Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touch.forward)),
      right: Math.max(-1, Math.min(1, Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.right)),
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.sprint,
      yaw: follow.yaw,
    };
    game.tick(dt, input);
    // 兜底：若浏览器漏发了 visibilitychange（无头/合成环境常见），回到前台的第一帧补做暂停判定。
    if (lastKnownHidden && !document.hidden) {
      const verdict = pauseAfterBackground({ playing: game.phase === 'playing', focused: document.hasFocus() }, hiddenAt, performance.now());
      hiddenAt = null;
      if (verdict === 'pause') {
        pauseGame();
        resumeNote = '你切到了后台，值班已自动暂停';
      }
    }
    lastKnownHidden = document.hidden;
    for (const event of game.drainEvents()) handleEvent(event);
    audio.update(game);
    hospital.sync(game, game.phase === 'playing' ? dt : 0);
    hospital.scene.updateMatrixWorld(true);
    if (game.phase === 'start') {
      // 标题待机时为背景走廊增加电影感微幅手持呼吸镜头（平滑正弦微晃，消除死板静止）
      const t = performance.now() * 0.0006;
      follow.yaw += Math.sin(t) * 0.0003;
      follow.pitch = Math.sin(t * 1.3) * 0.006;
    }
    follow.update(game.player.position);
    // 奔跑时镜头轻微扩张（72°→78°）、停下回落：给出速度感，又不破坏明亮克制的观感。
    const sprintingForFov = game.phase === 'playing' && input.sprint && (input.forward !== 0 || input.right !== 0);
    const targetFov = sprintingForFov ? 78 : 72;
    const nextFov = follow.camera.fov + (targetFov - follow.camera.fov) * Math.min(1, dt * 6);
    if (Math.abs(nextFov - follow.camera.fov) > 0.005) {
      follow.camera.fov = nextFov;
      follow.camera.updateProjectionMatrix();
    }
    if (escapingCutscene.active) {
      escapingCutscene.elapsed += dt;
      // 门打开进度 0..1 (前 1.1 秒推开)
      const p = Math.min(1, escapingCutscene.elapsed / 1.1);
      const eased = 1 - Math.pow(1 - p, 3);
      hospital.openExitDoor(eased);

      // 第一人称相机平滑前推穿过大门 (安全门在 x = 27，向东穿出)
      if (game.player.position.x < 28.3) {
        game.player.position.x += dt * 1.5;
      }
      follow.pitch = Math.max(-0.02, follow.pitch + dt * 0.08);

      // 晨光逐渐充盈屏幕
      if (escapingCutscene.elapsed > 0.25) {
        const flareP = Math.min(1, (escapingCutscene.elapsed - 0.25) / 0.85);
        escapeFlare.style.opacity = String(flareP * 0.88);
      }

      if (escapingCutscene.elapsed >= escapingCutscene.duration) {
        escapingCutscene.active = false;
        escapeFlare.style.opacity = '0';
        overlay.hidden = false;
        updateUI();
      }
    }
    renderer.render(hospital.scene, follow.camera);
    updateUI();
    updateThreatPointer();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
