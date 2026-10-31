import * as THREE from 'three';
import './style.css';
import { AudioEngine, VOICE_URLS } from './audio/audioEngine';
import { COMMANDS, COMMAND_COOLDOWN, COMMAND_IDS, DOORS, EXIT_POINT, FURNITURE_RECTS, GUARD_RADIUS, PLAYER_RADIUS, WALKABLE_RECTS } from './core/config';
import type { CommandId, DoorId, PlayerInput, Point } from './core/config';
import { dangerWindow, pauseAfterBackground } from './core/lifecycle';
import { distance } from './core/map';
import { RoundsGame } from './core/state';
import type { GameEvent, Phase } from './core/state';
import { FollowCamera } from './render/camera';
import { HospitalRenderer } from './render/scene';
import { SPRINT_EXHAUSTED_BELOW, isTap, sprintEngaged, stickAxes, touchControlsVisible } from './render/touch';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
  const follow = new FollowCamera(hospital.blockers);
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
  const minimap = element<HTMLCanvasElement>('minimap');
  const mapContext = minimap.getContext('2d');
  const mapNote = element('map-note');
  const corridorName = element('corridor-name');
  const commandButtons = Object.fromEntries(COMMAND_IDS.map(id => [id, element<HTMLButtonElement>(`command-${id}`)])) as Record<CommandId, HTMLButtonElement>;
  const debugState = element('debug-state');
  const debugButtons = ['debug-a', 'debug-b', 'debug-time', 'debug-exit'].map(id => element<HTMLButtonElement>(id));
  element('debug-panel').hidden = !debug;
  const mapPanel = document.querySelector<HTMLElement>('.map-panel');
  if (mapPanel) mapPanel.hidden = debug;

  // 触控层：粗指针设备才显示摇杆与按钮，桌面鼠标完全不受影响。
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const touchLayer = element<HTMLElement>('touch-controls');
  const touchStick = element<HTMLElement>('touch-stick');
  const touchThumb = element<HTMLElement>('touch-thumb');
  const touchSprint = element<HTMLButtonElement>('touch-sprint');
  const touchPause = element<HTMLButtonElement>('touch-pause');
  const hasTouch = touchControlsVisible(coarsePointer ? 'coarse' : 'fine') || navigator.maxTouchPoints > 0;
  touchLayer.hidden = !hasTouch;
  document.body.dataset.touch = String(hasTouch);
  element('touch-help').hidden = !hasTouch;
  if (hasTouch) help.querySelectorAll<HTMLElement>(':scope > div:not(#touch-help)').forEach(node => node.classList.add('keyboard-only'));
  const touch = { forward: 0, right: 0, sprint: false, stickId: -1, originX: 0, originY: 0, dragId: -1, dragX: 0, dragStartedAt: 0, dragMoved: 0 };

  const keys = new Set<string>();
  let dragging = false;
  let lastPointerX = 0;
  let previousPhase: Phase | null = null;
  let lastFrame = performance.now();
  let toastUntil = 0;
  let dangerUntil = 0;
  let uiTime = -1;
  let fatal = false;
  let contextLost = false;
  let hiddenAt: number | null = null;
  let resumeNote = '';
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
    resumeNote = '';
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
      case 'doorOpened': notice(`防火门 ${event.door} 已打开，路线恢复`); break;
      case 'doorBlocked': notice('无法落门：门框被占用，或另一扇门仍关闭'); break;
      case 'commandStarted':
        notice(event.message ?? '指令已发动');
        if (event.command === 'broadcast') audio.voice('ward');
        else if (event.command === 'lights') audio.chime();
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
        break;
      case 'won':
        clearInput();
        audio.stopRound();
        audio.chime();
        break;
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
    const p = game.player.position;
    ctx.fillStyle = '#2d7967'; ctx.beginPath(); ctx.arc(x0+p.x*s,z0+p.z*s,4.2,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#2d7967'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0+p.x*s,z0+p.z*s); ctx.lineTo(x0+(p.x+Math.cos(follow.yaw)*1.2)*s,z0+(p.z+Math.sin(follow.yaw)*1.2)*s); ctx.stroke();
    if (game.lightsOn || (distance(p,game.guard.position)<10 && game.map.hasLineOfSight(p,game.guard.position))) {
      ctx.fillStyle = '#a45b4c'; ctx.beginPath(); ctx.arc(x0+game.guard.position.x*s,z0+game.guard.position.z*s,4.1,0,Math.PI*2); ctx.fill();
    }
    corridorName.textContent = corridor(p);
    mapNote.textContent = game.exitUnlocked ? '东侧安全门已通电 · 绿灯为逃生路线' : game.lightsOn ? `开灯定位：值班员在${corridor(game.guard.position)}` : '绿点：你 · 东侧：安全门';
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
      chase: '被发现！转过墙角，或用 2 封锁追捕路线',
      search: '正在搜索 · 先躲开视线，再用 3 广播引开',
      broadcast: '广播核查中 · 值班员正在前往病房',
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
      debugState.textContent = `${game.phase} / ${game.remaining.toFixed(2)}s\n玩家 (${game.player.position.x.toFixed(2)}, ${game.player.position.z.toFixed(2)})\n值班员 (${game.guard.position.x.toFixed(2)}, ${game.guard.position.z.toFixed(2)})\n门：${game.map.closedDoor ?? '全开'} / 语音 ${audio.snapshot().decodedVoices}/8`;
      for (const button of debugButtons) button.disabled = game.phase !== 'playing';
    }
    if (previousPhase === game.phase) return;
    previousPhase = game.phase;
    document.body.dataset.phase = game.phase;
    overlay.hidden = game.phase === 'playing';
    pause.disabled = game.phase !== 'playing' && game.phase !== 'paused';
    pause.innerHTML = game.phase === 'paused' ? '继续 <kbd>Esc</kbd>' : '暂停 <kbd>Esc</kbd>';
    help.hidden = game.phase !== 'start';
    if (game.phase === 'paused') {
      kicker.textContent = '游玩时钟与值班员已冻结';
      title.textContent = '值班暂停。';
      copy.textContent = resumeNote || '返回页面不会自动继续。准备好后，再回到走廊。';
      primary.innerHTML = '继续值班 <span aria-hidden="true">→</span>';
      footnote.textContent = `本局已进行 ${(60 - game.remaining).toFixed(0)} 秒 · 已发动 ${game.commandsUsed} 次指令 · 倒计时、体力和主要音效在暂停时不推进。`;
    } else if (game.phase === 'won') {
      kicker.textContent = '值班记录 / 撤离成功';
      title.textContent = '你走出了医院。';
      copy.textContent = `安全门已抵达，逃离成功。本局发动 ${game.commandsUsed} 次指令，走出了住院部。`;
      primary.innerHTML = '再来一次 <span aria-hidden="true">→</span>';
      footnote.textContent = 'R 也可重开：位置、门、体力、倒计时与音效全部复位。';
    } else if (game.phase === 'lost') {
      kicker.textContent = '值班记录 / 巡查中断';
      title.textContent = '被值班员抓住。';
      copy.textContent = '下次留出一点距离。沿环形走廊绕行，不要和他迎面碰上。';
      primary.innerHTML = '再来一次 <span aria-hidden="true">→</span>';
      footnote.textContent = `本局坚持 ${Math.floor(game.elapsed)} 秒。按 R 或点击按钮重开。`;
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
    mute.textContent = muted ? '声音：关' : '声音：开';
    mute.setAttribute('aria-pressed', String(muted));
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
    if (event.code === 'Escape') { event.preventDefault(); togglePause(); }
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
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging || game.phase !== 'playing') return;
    follow.rotate((event.clientX - lastPointerX) * 0.006);
    lastPointerX = event.clientX;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', clearInput);
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
    touch.dragStartedAt = performance.now();
    touch.dragMoved = 0;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== touch.dragId || game.phase !== 'playing') return;
    const dx = event.clientX - touch.dragX;
    if (dx === 0) return;
    touch.dragX = event.clientX;
    touch.dragMoved += Math.abs(dx);
    // 一旦判定为拖动就持续转镜头；累计位移超过轻触阈值即视为拖动，不要求单帧位移足够大。
    if (touch.dragMoved > 12 || !isTap(touch.dragMoved, 0, performance.now() - touch.dragStartedAt)) {
      follow.rotate(dx * 0.006);
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
  follow.update(game.player.position, 0);
  updateUI();
  document.body.dataset.ready = 'true';
  document.body.dataset.touch = String(hasTouch);

  if (debug) {
    const state = () => ({
      phase: game.phase, elapsed: game.elapsed, remaining: game.remaining, unlocked: game.exitUnlocked,
      player: { ...game.player.position }, guard: { ...game.guard.position }, stamina: game.player.stamina,
      door: game.map.closedDoor, yaw: follow.yaw, keys: [...keys], audio: audio.snapshot(),
      guardMode: game.guard.mode, guardFacing: game.guard.facing, fov: +follow.camera.fov.toFixed(2),
      memory: { ...renderer.info.memory }, effect: game.activeEffect, commandsUsed: game.commandsUsed,
      presentation: hospital.snapshot(), camera: { x: follow.camera.position.x, y: follow.camera.position.y, z: follow.camera.position.z },
      renderedPlayer: hospital.playerPoint(), drawCalls: renderer.info.render.calls,
    });
    const controls = {
      state,
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
      forceContextLoss() { renderer.forceContextLoss(); },
      forceContextRestore() { renderer.forceContextRestore(); },
    };
    Object.assign(window, { __ROUNDS_GAME__: game, __ROUNDS_DEBUG__: controls });
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
    follow.update(game.player.position, dt);
    // 奔跑时镜头轻微扩张（62°→65°）、停下回落：给出速度感，又不破坏明亮克制的观感。
    const sprintingForFov = game.phase === 'playing' && input.sprint && (input.forward !== 0 || input.right !== 0);
    const targetFov = sprintingForFov ? 65 : 62;
    const nextFov = follow.camera.fov + (targetFov - follow.camera.fov) * Math.min(1, dt * 6);
    if (Math.abs(nextFov - follow.camera.fov) > 0.005) {
      follow.camera.fov = nextFov;
      follow.camera.updateProjectionMatrix();
    }
    const cameraGap = Math.hypot(follow.camera.position.x-game.player.position.x, follow.camera.position.z-game.player.position.z);
    hospital.playerHuman.setOpacity(cameraGap < 1.4 ? 0.25 : 1);
    renderer.render(hospital.scene, follow.camera);
    updateUI();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
