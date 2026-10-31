import type { RoundsGame } from '../core/state';
import { distance } from '../core/map';
import type { Point } from '../core/config';
import { secondsUntilFootstep, secondsUntilGuardBell, heartbeatInterval } from '../core/ambience';

// 静态 URL 必须相对本模块写对，Vite 才会将 MP3 随正式构建打包。
export const VOICE_URLS = {
  start: new URL('../../assets/audio/voices/pa_shift_start.mp3', import.meta.url).href,
  door: new URL('../../assets/audio/voices/pa_door_closing.mp3', import.meta.url).href,
  warning30: new URL('../../assets/audio/voices/pa_30s_left.mp3', import.meta.url).href,
  warning10: new URL('../../assets/audio/voices/pa_10s_left.mp3', import.meta.url).href,
  unlocked: new URL('../../assets/audio/voices/pa_exit_unlocked.mp3', import.meta.url).href,
  ward: new URL('../../assets/audio/voices/pa_ward_call.mp3', import.meta.url).href,
  lights: new URL('../../assets/audio/voices/pa_lights_on.mp3', import.meta.url).href,
  lockdown: new URL('../../assets/audio/voices/pa_lockdown.mp3', import.meta.url).href,
  chase: new URL('../../assets/audio/voices/warden_chase.mp3', import.meta.url).href,
  patrol: new URL('../../assets/audio/voices/warden_patrol_01.mp3', import.meta.url).href,
  caught: new URL('../../assets/audio/voices/warden_catch.mp3', import.meta.url).href,
};
export type VoiceId = keyof typeof VOICE_URLS;

export const VOICE_TEXT: Record<VoiceId, string> = {
  start: '夜间巡查已开始，请保持安静，等待东侧安全门解锁。',
  door: '注意，走廊防火门已降下封锁。',
  warning30: '距离东侧安全门解锁还有三十秒。',
  warning10: '最后十秒，准备前往东侧安全门。',
  unlocked: '东侧安全门已解锁，门已打开，请立即撤离。',
  ward: '各科室注意，广播查房已启动，值班员已转向大厅。',
  lights: '全院备用照明已开启，强光透视已接通。',
  lockdown: '紧急通报，防火卷帘门已强制降下，通道封锁。',
  chase: '站住！夜间巡查，不许跑！',
  patrol: '谁在那边？夜间严禁在走廊逗留。',
  caught: '抓到你了，立刻返回病房。',
};

export const BGM_URLS = {
  menu: new URL('../../assets/audio/bgm/bgm_menu_theme.mp3', import.meta.url).href,
  ambience: new URL('../../assets/audio/bgm/bgm_hospital_ambience.mp3', import.meta.url).href,
};
export type BgmId = keyof typeof BGM_URLS;

export const SFX_URLS = {
  walk: new URL('../../assets/audio/sfx/sfx_footstep_walk.mp3', import.meta.url).href,
  sprint: new URL('../../assets/audio/sfx/sfx_footstep_sprint.mp3', import.meta.url).href,
  wardenStep: new URL('../../assets/audio/sfx/sfx_warden_step.mp3', import.meta.url).href,
  wardenBell: new URL('../../assets/audio/sfx/sfx_warden_bell.mp3', import.meta.url).href,
  lightSwitch: new URL('../../assets/audio/sfx/sfx_light_switch.mp3', import.meta.url).href,
  lightsSurge: new URL('../../assets/audio/sfx/sfx_lights_surge.mp3', import.meta.url).href,
  doorSlam: new URL('../../assets/audio/sfx/sfx_door_slam.mp3', import.meta.url).href,
  doorOpen: new URL('../../assets/audio/sfx/sfx_door_open.mp3', import.meta.url).href,
  lockdownSlam: new URL('../../assets/audio/sfx/sfx_lockdown_slam.mp3', import.meta.url).href,
  paChime: new URL('../../assets/audio/sfx/sfx_pa_chime.mp3', import.meta.url).href,
  dangerSting: new URL('../../assets/audio/sfx/sfx_danger_sting.mp3', import.meta.url).href,
  escapeWin: new URL('../../assets/audio/sfx/sfx_escape_win.mp3', import.meta.url).href,
  breathGasp: new URL('../../assets/audio/sfx/sfx_breath_gasp.mp3', import.meta.url).href,
  buzzDenied: new URL('../../assets/audio/sfx/sfx_buzz_denied.mp3', import.meta.url).href,
};
export type SfxId = keyof typeof SFX_URLS;

/** 默认进入即开启声音与微恐背景音乐，支持浏览器自动播放与首次微交互瞬时解锁。 */
export class AudioEngine {
  muted = false;
  ready = false;
  issue = '';
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<VoiceId, AudioBuffer>();
  private bgmBuffers = new Map<BgmId, AudioBuffer>();
  private sfxBuffers = new Map<SfxId, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private nodes = new Set<AudioScheduledSourceNode>();
  private currentVoice: AudioBufferSourceNode | null = null;
  private currentBgm: AudioBufferSourceNode | null = null;
  private currentBgmGain: GainNode | null = null;
  private currentBgmId: BgmId | null = null;
  private bgmElement: HTMLAudioElement | null = null;
  private voiceElement: HTMLAudioElement | null = null;
  private pendingVoice: VoiceId | null = null;
  private voiceDucking = false;
  private targetBgmVolume = 0.78;
  private unlockBound = false;
  private generation = 0;
  private active = false;
  private paused = false;
  private nextPlayerStep = 0;
  private nextGuardStep = 0;
  private nextBellStep = 0;
  private nextBreathStep = 0;
  private nextHeartbeat = 0;
  private lastPlayer: Point | null = null;
  private lastGuard: Point | null = null;
  private patrolSpoken = false;

  private ensureContext(): boolean {
    try {
      if (!this.context) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.context = new Ctx();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }
      this.applyVolume();
      if (this.context.state === 'suspended' && !this.paused) {
        void this.context.resume().catch(() => {});
      }
      if (!this.loading) this.loading = this.loadAllAssets();
      this.bindAutoUnlock();
      return true;
    } catch {
      this.issue = '此浏览器无法启用声音，游戏仍可继续';
      return false;
    }
  }

  /** 在真实用户手势（点击/触摸/按键）内同步解锁 WebAudio 与 HTMLAudioElement */
  unlock(): void {
    this.ensureContext();
    if (this.context && this.context.state === 'suspended' && !this.paused) {
      void this.context.resume().then(() => {
        if (!this.ready && !this.loading) {
          this.loading = this.loadAllAssets();
        }
        // 如果 WebAudio 恢复但 HTMLAudio 被拦截，使用 WebAudio 兜底播放 BGM
        if (this.currentBgmId && (!this.bgmElement || this.bgmElement.paused) && !this.currentBgm && !this.muted && !this.paused) {
          this.playWebAudioBgm(this.currentBgmId, this.targetBgmVolume);
        }
      }).catch(() => {});
    }
    if (this.bgmElement && this.bgmElement.paused && !this.paused && !this.muted) {
      void this.bgmElement.play().then(() => {
        // HTMLAudio 正常发声时停止重复的 WebAudio BGM
        if (this.currentBgm) {
          try { this.currentBgm.stop(); } catch {}
          this.currentBgm = null;
        }
      }).catch(() => {
        if (this.currentBgmId && !this.currentBgm) {
          this.playWebAudioBgm(this.currentBgmId, this.targetBgmVolume);
        }
      });
    }
  }

  private bindAutoUnlock(): void {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    // 仅绑定浏览器认可的真实用户激活手势（User Activation），确保 100% 触发音频解锁
    const events = ['pointerdown', 'mousedown', 'touchstart', 'touchend', 'keydown', 'click'];
    const tryResume = () => {
      this.unlock();
      const ctxRunning = Boolean(this.context && this.context.state === 'running');
      const bgmPlaying = Boolean((this.bgmElement && !this.bgmElement.paused) || this.currentBgm);
      if (ctxRunning && bgmPlaying) {
        for (const ev of events) window.removeEventListener(ev, tryResume, true);
        this.unlockBound = false;
      }
    };
    for (const ev of events) {
      window.addEventListener(ev, tryResume, { capture: true, passive: true });
    }
  }

  /** 进入页面默认立即播放微恐深邃菜单主题 BGM */
  startMenuBgm(): void {
    this.ensureContext();
    this.switchBgmTrack('menu', 0.78);
  }

  startRound(): void {
    this.stopRoundNodes();
    this.active = true;
    this.paused = false;
    this.nextPlayerStep = 0;
    this.nextGuardStep = 0;
    this.nextBellStep = 0;
    this.nextBreathStep = 0;
    this.nextHeartbeat = 0;
    this.lastPlayer = null;
    this.lastGuard = null;
    this.patrolSpoken = false;
    if (!this.ensureContext()) return;
    this.startHum();
    this.switchBgmTrack('ambience', 0.68);
    this.paDing();
    this.voice('start');
  }

  private stopRoundNodes(): void {
    this.generation += 1;
    this.active = false;
    for (const node of this.nodes) {
      try { node.stop(); } catch { /* 已结束的短音源无需再次停止 */ }
    }
    this.nodes.clear();
    this.currentVoice = null;
    this.currentBgm = null;
    this.currentBgmGain = null;
    if (this.voiceElement) {
      try { this.voiceElement.pause(); } catch {}
    }
  }

  stopRound(): void {
    this.stopRoundNodes();
    // 结算页保持微恐背景乐低回环绕，不陷入死寂
    this.switchBgmTrack('menu', 0.62);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (this.bgmElement) {
      // 暂停菜单下降低 BGM 音量保留恐怖氛围
      this.bgmElement.volume = this.muted ? 0 : (paused ? this.targetBgmVolume * 0.45 : this.targetBgmVolume);
      if (!paused && this.bgmElement.paused && !this.muted) {
        void this.bgmElement.play().catch(() => {});
      }
    }
    if (this.currentBgmGain && this.context) {
      this.currentBgmGain.gain.setValueAtTime(
        this.muted ? 0 : (paused ? this.targetBgmVolume * 0.45 : this.targetBgmVolume),
        this.context.currentTime,
      );
    }
    if (!this.context) return;
    const operation = paused ? this.context.suspend() : this.context.resume();
    void operation.catch(() => { this.issue = '声音暂停状态未能切换'; });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolume();
    return this.muted;
  }

  private switchBgmTrack(id: BgmId, volume: number): void {
    this.targetBgmVolume = volume;
    this.currentBgmId = id;
    // 1. 优先尝试 WebAudio Buffer 循环播放（不受 5 秒倒计时后非手势切换 src 的限制）
    if (this.context && this.master) {
      this.playWebAudioBgm(id, volume);
    }
    // 2. 同时准备 HTMLAudioElement 流式兜底（在 WebAudio 尚未解码完成前立即出声）
    if (typeof Audio !== 'undefined') {
      if (!this.bgmElement) {
        this.bgmElement = new Audio();
        this.bgmElement.loop = true;
        this.bgmElement.preload = 'auto';
        this.bgmElement.autoplay = true;
      }
      const nextUrl = BGM_URLS[id];
      if (!this.bgmElement.src || !this.bgmElement.src.endsWith(nextUrl.split('/').pop()!)) {
        this.bgmElement.src = nextUrl;
      }
      this.bgmElement.muted = this.muted;
      // 若 WebAudio BGM 已在运行，则将 HTMLAudio 静音避免双重叠加；否则由 HTMLAudio 出声
      const webAudioPlaying = Boolean(this.currentBgm && this.context?.state === 'running');
      this.bgmElement.volume = (this.muted || webAudioPlaying) ? 0 : (this.paused ? volume * 0.45 : volume);
      if (this.bgmElement.paused && !this.muted && !webAudioPlaying) {
        void this.bgmElement.play().catch(() => {
          this.bindAutoUnlock();
        });
      }
    }
  }

  private playWebAudioBgm(id: BgmId, volume: number): void {
    if (!this.context || !this.master) return;
    const generation = this.generation;
    const startLoop = () => {
      if (generation !== this.generation || !this.context || !this.master || this.currentBgmId !== id) return;
      const buffer = this.bgmBuffers.get(id);
      if (!buffer) return;
      if (this.currentBgm) {
        try { this.currentBgm.stop(); } catch { /* 忽略已停止节点 */ }
      }
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = this.muted ? 0 : (this.paused ? volume * 0.45 : volume);
      source.connect(gain);
      gain.connect(this.master);
      this.track(source);
      this.currentBgm = source;
      this.currentBgmGain = gain;
      source.start();
      // WebAudio 已接管 BGM 时，关闭 HTMLAudio 音量防止重音
      if (this.bgmElement && this.context.state === 'running') {
        this.bgmElement.volume = 0;
      }
    };
    if (this.bgmBuffers.has(id)) startLoop();
    else void this.loading?.then(startLoop);
  }

  private playSfx(id: SfxId, volume = 0.85, playbackRate = 1.0): boolean {
    if (this.muted || this.paused) return false;
    if (this.context && this.master) {
      if (this.context.state === 'suspended') {
        void this.context.resume().catch(() => {});
      }
      const buffer = this.sfxBuffers.get(id);
      if (buffer) {
        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(this.master);
        this.track(source);
        source.start();
        return true;
      }
    }
    if (typeof Audio !== 'undefined') {
      try {
        const el = new Audio(SFX_URLS[id]);
        el.volume = Math.min(1, volume);
        el.playbackRate = playbackRate;
        void el.play().catch(() => {});
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  voice(id: VoiceId): void {
    if (this.muted || this.paused) return;
    if (!this.context || !this.master) {
      this.ensureContext();
    }
    if (this.context && this.context.state === 'suspended') {
      void this.context.resume().catch(() => {});
    }
    this.pendingVoice = id;
    const generation = this.generation;
    const play = () => {
      if (generation !== this.generation || this.paused || this.muted || this.pendingVoice !== id) return;
      const buffer = this.buffers.get(id);
      if (buffer && this.context && this.master && this.context.state === 'running') {
        this.pendingVoice = null;
        if (this.voiceElement) {
          try { this.voiceElement.pause(); } catch {}
        }
        if (this.currentVoice) {
          try { this.currentVoice.stop(); } catch { /* 语音可能刚刚自然结束 */ }
        }
        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        source.buffer = buffer;
        gain.gain.value = 1.65;
        source.connect(gain);
        gain.connect(this.master);
        this.setVoiceDucking(true);
        this.track(source);
        this.currentVoice = source;
        source.start();
        return;
      }
      if (typeof Audio !== 'undefined') {
        try {
          if (this.voiceElement) {
            this.voiceElement.pause();
          }
          const el = new Audio(VOICE_URLS[id]);
          el.preload = 'auto';
          el.volume = 1.0;
          this.voiceElement = el;
          this.setVoiceDucking(true);
          el.onended = () => {
            if (this.voiceElement === el) this.setVoiceDucking(false);
          };
          void el.play().then(() => {
            if (this.pendingVoice === id) this.pendingVoice = null;
          }).catch(() => {
            this.setVoiceDucking(false);
            this.speakFallback(id);
          });
          return;
        } catch {}
      }
      this.speakFallback(id);
    };
    play();
  }

  /** 零体积浏览器原生语音合成兜底（仅当音频流被拦截或解码未就绪时触发） */
  private speakFallback(id: VoiceId): void {
    if (this.muted || this.paused || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(VOICE_TEXT[id]);
      utter.lang = 'zh-CN';
      utter.rate = 1.05;
      utter.pitch = 0.88;
      utter.volume = 1.0;
      utter.onstart = () => this.setVoiceDucking(true);
      utter.onend = () => {
        if (this.pendingVoice === id) this.pendingVoice = null;
        this.setVoiceDucking(false);
      };
      utter.onerror = () => this.setVoiceDucking(false);
      window.speechSynthesis.speak(utter);
    } catch {}
  }

  /** TTS 播报期间自动压低背景乐（Ducking），确保人声清晰突出 */
  private setVoiceDucking(ducking: boolean): void {
    if (this.voiceDucking === ducking) return;
    this.voiceDucking = ducking;
    this.applyVolume();
  }

  doorSound(): void {
    if (this.playSfx('doorSlam', 0.88)) return;
    this.tone(85, 0.22, 0.17, 'triangle');
    this.tone(160, 0.11, 0.09, 'triangle');
  }

  /** 门重开：电磁锁弹开与防火门滑轨音效 */
  doorOpenSound(): void {
    if (this.playSfx('doorOpen', 0.78)) return;
    this.tone(150, 0.1, 0.09, 'triangle');
    this.tone(230, 0.16, 0.06, 'triangle');
  }

  /** 开灯：工业断路器合闸与镇流器电流声 */
  lightSwitch(): void {
    if (this.playSfx('lightSwitch', 0.82)) return;
    this.tone(1900, 0.022, 0.07, 'square');
    this.tone(1400, 0.03, 0.05, 'square');
  }

  /** 广播前的微恐失谐医院内线提示音 */
  paDing(): void {
    if (this.playSfx('paChime', 0.72)) return;
    this.tone(660, 0.09, 0.075, 'sine');
    this.tone(880, 0.14, 0.055, 'sine');
  }

  alert(): void {
    if (this.playSfx('dangerSting', 0.92)) return;
    this.tone(420, 0.16, 0.09, 'triangle');
    this.tone(600, 0.19, 0.045, 'sine');
  }

  chime(): void {
    if (this.playSfx('escapeWin', 0.85)) return;
    this.tone(523.25, 0.24, 0.11);
    this.tone(659.25, 0.34, 0.07);
    this.tone(783.99, 0.4, 0.055);
  }

  /** 开灯技能专属：高压电容升压充能音效 + 闸刀合闸 + 全院应急照明通报 */
  lightsSound(): void {
    if (!this.playSfx('lightsSurge', 0.95)) {
      this.lightSwitch();
    }
    this.voice('lights');
  }

  /** 封锁技能专属：重型防火卷帘门液压气动降落砸地 + 紧急封锁通报 */
  lockdownSound(): void {
    if (!this.playSfx('lockdownSlam', 0.95)) {
      this.doorSound();
    }
    this.voice('lockdown');
  }

  /** 广播查房技能专属：医院微恐失谐提示音 + 病房内线呼叫通报 */
  broadcastSound(): void {
    this.paDing();
    this.voice('ward');
  }

  /** 指令受阻/冷却中拒绝提示：短路蜂鸣音效 */
  buzzError(): void {
    if (this.playSfx('buzzDenied', 0.88)) return;
    this.tone(160, 0.12, 0.18, 'sawtooth');
    this.tone(110, 0.14, 0.14, 'square');
  }

  /**
   * 心理微恐动态双重重击心跳 (Lub-Dub)：
   * 追逐或迫近时低频共振撞击耳膜，模拟恐慌窒息感。
   */
  heartbeat(volume: number): void {
    if (!this.context || !this.master || this.muted || this.paused) return;
    const now = this.context.currentTime;
    const v = Math.min(1.0, Math.max(0.04, volume));
    // S1: Lub (低频 62Hz 沉重骤缩)
    const s1 = this.context.createOscillator();
    const g1 = this.context.createGain();
    s1.type = 'sine';
    s1.frequency.setValueAtTime(62, now);
    s1.frequency.exponentialRampToValueAtTime(38, now + 0.08);
    g1.gain.setValueAtTime(0, now);
    g1.gain.linearRampToValueAtTime(v * 0.95, now + 0.006);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
    s1.connect(g1);
    g1.connect(this.master);
    this.track(s1);
    s1.start(now);
    s1.stop(now + 0.09);

    // S2: Dub (稍高 82Hz，相隔 110ms 紧随其后)
    const s2 = this.context.createOscillator();
    const g2 = this.context.createGain();
    s2.type = 'sine';
    s2.frequency.setValueAtTime(82, now + 0.11);
    s2.frequency.exponentialRampToValueAtTime(48, now + 0.18);
    g2.gain.setValueAtTime(0, now + 0.11);
    g2.gain.linearRampToValueAtTime(v * 0.68, now + 0.116);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.185);
    s2.connect(g2);
    g2.connect(this.master);
    this.track(s2);
    s2.start(now + 0.11);
    s2.stop(now + 0.19);
  }

  update(game: RoundsGame): void {
    if (!this.active || this.paused || game.phase !== 'playing') return;
    const moved = this.lastPlayer ? distance(this.lastPlayer, game.player.position) > 0.002 : false;
    const guardMoved = this.lastGuard ? distance(this.lastGuard, game.guard.position) > 0.002 : false;
    if (moved && game.elapsed >= this.nextPlayerStep) {
      const rate = 0.94 + Math.random() * 0.12;
      const played = game.player.sprinting
        ? this.playSfx('sprint', 0.65, rate)
        : this.playSfx('walk', 0.48, rate);
      if (!played) this.tone(game.player.sprinting ? 118 : 100, 0.075, 0.075);
      this.nextPlayerStep = game.elapsed + (game.player.sprinting ? 0.26 : 0.42);
    }
    if (game.player.sprinting && game.player.stamina < 18 && game.elapsed >= this.nextBreathStep) {
      this.playSfx('breathGasp', 0.55);
      this.nextBreathStep = game.elapsed + 5.5;
    }
    const gap = distance(game.player.position, game.guard.position);
    // 脚步与追逐心跳/钥匙声均按秒表排程，不靠逐帧计数。
    const heartWait = heartbeatInterval(game.guard.mode, gap);
    if (heartWait !== Infinity && game.elapsed >= this.nextHeartbeat) {
      const isChase = game.guard.mode === 'chase';
      const vol = isChase
        ? Math.min(1.0, 0.52 + (1 - Math.min(gap, 18) / 18) * 0.48)
        : Math.min(0.55, 0.38 * (1 - gap / 6.5));
      this.heartbeat(vol);
      this.nextHeartbeat = game.elapsed + heartWait;
    }
    if (guardMoved && game.elapsed >= this.nextGuardStep) {
      const wait = secondsUntilFootstep(game.elapsed, game.guard.mode, gap);
      if (wait !== Infinity) {
        const vol = Math.min(0.9, 0.72 / (1 + gap * 0.25));
        if (!this.playSfx('wardenStep', vol, 0.96 + Math.random() * 0.08)) {
          this.tone(70, 0.1, 0.1 / (1 + gap * 0.35));
        }
        this.nextGuardStep = game.elapsed + wait;
      } else {
        this.nextGuardStep = game.elapsed + 0.2;
      }
    }
    if (game.elapsed >= this.nextBellStep) {
      const wait = secondsUntilGuardBell(game.elapsed, game.guard.mode, gap);
      if (wait !== Infinity) {
        const vol = Math.min(0.92, 0.78 / (1 + gap * 0.18));
        if (!this.playSfx('wardenBell', vol)) {
          this.tone(880, 0.06, 0.05, 'square');
        }
        this.nextBellStep = game.elapsed + wait;
      } else {
        this.nextBellStep = game.elapsed + 0.2;
      }
    }
    if (!this.patrolSpoken && game.elapsed >= 8 && gap < 12) {
      this.patrolSpoken = true;
      this.voice('patrol');
    }
    this.lastPlayer = { ...game.player.position };
    this.lastGuard = { ...game.guard.position };
  }

  snapshot() {
    return {
      ready: this.ready,
      muted: this.muted,
      issue: this.issue,
      context: this.context?.state ?? 'not-started',
      bgmTrack: this.currentBgmId,
      bgmPlaying: this.bgmElement ? !this.bgmElement.paused : Boolean(this.currentBgm),
      decodedVoices: this.buffers.size,
      decodedBgm: this.bgmBuffers.size,
      decodedSfx: this.sfxBuffers.size,
      liveSources: this.nodes.size,
    };
  }

  private async loadAllAssets(): Promise<void> {
    const context = this.context;
    if (!context) return;
    // 严格限制音频并发请求数为 2，最优先加载极轻量 TTS 语音（单条仅 23~49KB），确保开局与关键倒计时 TTS 零延迟瞬发
    type Task = () => Promise<void>;
    const tasks: Task[] = [];
    const enqueue = <K extends string>(entries: [K, string][], target: Map<K, AudioBuffer>, isVoice = false) => {
      for (const [id, url] of entries) {
        tasks.push(async () => {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            target.set(id, buffer);
            if (isVoice && this.pendingVoice === (id as unknown as VoiceId)) {
              this.voice(id as unknown as VoiceId);
            }
          } catch {
            if (isVoice) {
              this.issue = '部分语音加载失败，游戏仍可继续';
              if (this.pendingVoice === (id as unknown as VoiceId)) {
                this.speakFallback(id as unknown as VoiceId);
              }
            }
          }
        });
      }
    };
    enqueue(Object.entries(VOICE_URLS) as [VoiceId, string][], this.buffers, true);
    enqueue(Object.entries(SFX_URLS) as [SfxId, string][], this.sfxBuffers);
    enqueue(Object.entries(BGM_URLS) as [BgmId, string][], this.bgmBuffers);

    const concurrency = 2;
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const index = cursor++;
        await tasks[index]();
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    this.ready = true;
  }

  private applyVolume(): void {
    const duckFactor = this.voiceDucking ? 0.35 : 1;
    const effectiveBgmVol = (this.paused ? this.targetBgmVolume * 0.45 : this.targetBgmVolume) * duckFactor;
    if (this.context && this.master) {
      this.master.gain.setValueAtTime(this.muted ? 0 : 1.35, this.context.currentTime);
    }
    if (this.currentBgmGain && this.context) {
      this.currentBgmGain.gain.setValueAtTime(
        this.muted ? 0 : effectiveBgmVol,
        this.context.currentTime,
      );
    }
    if (this.bgmElement) {
      const webAudioPlaying = Boolean(this.currentBgm && this.context?.state === 'running');
      this.bgmElement.muted = this.muted;
      this.bgmElement.volume = (this.muted || webAudioPlaying) ? 0 : effectiveBgmVol;
      if (!this.muted && !this.paused && !webAudioPlaying && this.bgmElement.paused) {
        void this.bgmElement.play().catch(() => {});
      }
    }
    if (this.voiceElement) {
      this.voiceElement.muted = this.muted;
      this.voiceElement.volume = this.muted ? 0 : 1.0;
    }
  }

  /** 医院底噪两层：空调低频隆隆 + 荧光灯镇流器嗡鸣，衬托 BGM 与脚步声。 */
  private startHum(): void {
    if (!this.context || !this.master) return;
    const rumble = this.context.createOscillator();
    const rumbleGain = this.context.createGain();
    rumble.frequency.value = 54;
    rumbleGain.gain.value = 0.008;
    rumble.connect(rumbleGain);
    rumbleGain.connect(this.master);
    this.track(rumble);
    rumble.start();
    const buzz = this.context.createOscillator();
    const buzzGain = this.context.createGain();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 119;
    buzzGain.gain.value = 0.0025;
    buzz.connect(buzzGain);
    buzzGain.connect(this.master);
    this.track(buzz);
    buzz.start();
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine'): void {
    if (!this.context || !this.master || this.paused) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.75, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.track(oscillator);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  /** 安全门推开与锁扣弹开的厚重气动沉浸音效 */
  playDoorOpenSound(): void {
    if (!this.context || !this.master || this.muted) return;
    if (this.playSfx('doorOpen', 0.88)) return;
    const now = this.context.currentTime;
    const clickOsc = this.context.createOscillator();
    const clickGain = this.context.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(480, now);
    clickOsc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
    clickGain.gain.setValueAtTime(0.28, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    clickOsc.connect(clickGain);
    clickGain.connect(this.master);
    this.track(clickOsc);
    clickOsc.start(now);
    clickOsc.stop(now + 0.14);
  }

  private track(source: AudioScheduledSourceNode): void {
    this.nodes.add(source);
    source.onended = () => {
      this.nodes.delete(source);
      source.disconnect();
      if (this.currentVoice === source) {
        this.currentVoice = null;
        this.setVoiceDucking(false);
      }
      if (this.currentBgm === source) {
        this.currentBgm = null;
      }
    };
  }
}
