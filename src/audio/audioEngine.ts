import type { RoundsGame } from '../core/state';
import { distance } from '../core/map';
import type { Point } from '../core/config';
import { secondsUntilFootstep, secondsUntilGuardBell } from '../core/ambience';

// 静态 URL 必须相对本模块写对，Vite 才会将 MP3 随正式构建打包。
export const VOICE_URLS = {
  start: new URL('../../assets/audio/voices/pa_shift_start.mp3', import.meta.url).href,
  door: new URL('../../assets/audio/voices/pa_door_closing.mp3', import.meta.url).href,
  warning30: new URL('../../assets/audio/voices/pa_30s_left.mp3', import.meta.url).href,
  warning10: new URL('../../assets/audio/voices/pa_10s_left.mp3', import.meta.url).href,
  unlocked: new URL('../../assets/audio/voices/pa_exit_unlocked.mp3', import.meta.url).href,
  ward: new URL('../../assets/audio/voices/pa_ward_call.mp3', import.meta.url).href,
  patrol: new URL('../../assets/audio/voices/warden_patrol_01.mp3', import.meta.url).href,
  caught: new URL('../../assets/audio/voices/warden_catch.mp3', import.meta.url).href,
};
export type VoiceId = keyof typeof VOICE_URLS;

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
  doorSlam: new URL('../../assets/audio/sfx/sfx_door_slam.mp3', import.meta.url).href,
  doorOpen: new URL('../../assets/audio/sfx/sfx_door_open.mp3', import.meta.url).href,
  paChime: new URL('../../assets/audio/sfx/sfx_pa_chime.mp3', import.meta.url).href,
  dangerSting: new URL('../../assets/audio/sfx/sfx_danger_sting.mp3', import.meta.url).href,
  escapeWin: new URL('../../assets/audio/sfx/sfx_escape_win.mp3', import.meta.url).href,
  breathGasp: new URL('../../assets/audio/sfx/sfx_breath_gasp.mp3', import.meta.url).href,
};
export type SfxId = keyof typeof SFX_URLS;

/** 用户手势后建立 AudioContext，驱动微恐医院 BGM、统一慢速阴冷广播语音与真实音效。 */
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
  private currentBgmId: BgmId | null = null;
  private generation = 0;
  private active = false;
  private paused = false;
  private nextPlayerStep = 0;
  private nextGuardStep = 0;
  private nextBellStep = 0;
  private nextBreathStep = 0;
  private lastPlayer: Point | null = null;
  private lastGuard: Point | null = null;
  private patrolSpoken = false;

  private ensureContext(): boolean {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }
      this.applyVolume();
      void this.context.resume().catch(() => { this.issue = '声音未能启动，游戏仍可继续'; });
      if (!this.loading) this.loading = this.loadAllAssets();
      return true;
    } catch {
      this.issue = '此浏览器无法启用声音，游戏仍可继续';
      return false;
    }
  }

  /** 首页交互后自动播放微恐深邃菜单主题 BGM */
  startMenuBgm(): void {
    if (this.active || this.currentBgmId === 'menu') return;
    if (!this.ensureContext()) return;
    this.playBgm('menu', 0.24);
  }

  startRound(): void {
    this.stopRound();
    this.active = true;
    this.paused = false;
    this.nextPlayerStep = 0;
    this.nextGuardStep = 0;
    this.nextBellStep = 0;
    this.nextBreathStep = 0;
    this.lastPlayer = null;
    this.lastGuard = null;
    this.patrolSpoken = false;
    if (!this.ensureContext()) return;
    this.startHum();
    this.playBgm('ambience', 0.28);
    this.paDing();
    this.voice('start');
  }

  stopRound(): void {
    this.generation += 1;
    this.active = false;
    for (const node of this.nodes) {
      try { node.stop(); } catch { /* 已结束的短音源无需再次停止 */ }
    }
    this.nodes.clear();
    this.currentVoice = null;
    this.currentBgm = null;
    this.currentBgmId = null;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!this.context) return;
    const operation = paused ? this.context.suspend() : this.context.resume();
    void operation.catch(() => { this.issue = '声音暂停状态未能切换'; });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolume();
    return this.muted;
  }

  private playBgm(id: BgmId, volume: number): void {
    if (!this.context || !this.master) return;
    const generation = this.generation;
    const startLoop = () => {
      if (generation !== this.generation || !this.context || !this.master) return;
      const buffer = this.bgmBuffers.get(id);
      if (!buffer) return;
      if (this.currentBgm) {
        try { this.currentBgm.stop(); } catch { /* 忽略已停止节点 */ }
      }
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(this.master);
      this.track(source);
      this.currentBgm = source;
      this.currentBgmId = id;
      source.start();
    };
    if (this.bgmBuffers.has(id)) startLoop();
    else void this.loading?.then(startLoop);
  }

  private playSfx(id: SfxId, volume = 0.65, playbackRate = 1.0): boolean {
    if (!this.context || !this.master || this.paused) return false;
    const buffer = this.sfxBuffers.get(id);
    if (!buffer) return false;
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

  voice(id: VoiceId): void {
    if (!this.context || !this.master) return;
    const generation = this.generation;
    const play = () => {
      if (generation !== this.generation || this.paused) return;
      const buffer = this.buffers.get(id);
      if (!buffer || !this.context || !this.master) return;
      if (this.currentVoice) {
        try { this.currentVoice.stop(); } catch { /* 语音可能刚刚自然结束 */ }
      }
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.96;
      source.connect(gain);
      gain.connect(this.master);
      this.track(source);
      this.currentVoice = source;
      source.start();
    };
    if (this.ready) play();
    else void this.loading?.then(play);
  }

  doorSound(): void {
    if (this.playSfx('doorSlam', 0.82)) return;
    this.tone(85, 0.22, 0.17, 'triangle');
    this.tone(160, 0.11, 0.09, 'triangle');
  }

  /** 门重开：电磁锁弹开与防火门滑轨音效 */
  doorOpenSound(): void {
    if (this.playSfx('doorOpen', 0.72)) return;
    this.tone(150, 0.1, 0.09, 'triangle');
    this.tone(230, 0.16, 0.06, 'triangle');
  }

  /** 开灯：工业断路器合闸与镇流器电流声 */
  lightSwitch(): void {
    if (this.playSfx('lightSwitch', 0.75)) return;
    this.tone(1900, 0.022, 0.07, 'square');
    this.tone(1400, 0.03, 0.05, 'square');
  }

  /** 广播前的微恐失谐医院内线提示音 */
  paDing(): void {
    if (this.playSfx('paChime', 0.62)) return;
    this.tone(660, 0.09, 0.075, 'sine');
    this.tone(880, 0.14, 0.055, 'sine');
  }

  alert(): void {
    if (this.playSfx('dangerSting', 0.85)) return;
    this.tone(420, 0.16, 0.09, 'triangle');
    this.tone(600, 0.19, 0.045, 'sine');
  }

  chime(): void {
    if (this.playSfx('escapeWin', 0.78)) return;
    this.tone(523.25, 0.24, 0.11);
    this.tone(659.25, 0.34, 0.07);
    this.tone(783.99, 0.4, 0.055);
  }

  update(game: RoundsGame): void {
    if (!this.active || this.paused || game.phase !== 'playing') return;
    const moved = this.lastPlayer ? distance(this.lastPlayer, game.player.position) > 0.002 : false;
    const guardMoved = this.lastGuard ? distance(this.lastGuard, game.guard.position) > 0.002 : false;
    if (moved && game.elapsed >= this.nextPlayerStep) {
      const rate = 0.94 + Math.random() * 0.12;
      const played = game.player.sprinting
        ? this.playSfx('sprint', 0.58, rate)
        : this.playSfx('walk', 0.42, rate);
      if (!played) this.tone(game.player.sprinting ? 118 : 100, 0.075, 0.075);
      this.nextPlayerStep = game.elapsed + (game.player.sprinting ? 0.26 : 0.42);
    }
    if (game.player.sprinting && game.player.stamina < 18 && game.elapsed >= this.nextBreathStep) {
      this.playSfx('breathGasp', 0.48);
      this.nextBreathStep = game.elapsed + 5.5;
    }
    const gap = distance(game.player.position, game.guard.position);
    // 脚步与追逐心跳/钥匙声均按秒表排程，不靠逐帧计数。
    if (guardMoved && game.elapsed >= this.nextGuardStep) {
      const wait = secondsUntilFootstep(game.elapsed, game.guard.mode, gap);
      if (wait !== Infinity) {
        const vol = Math.min(0.85, 0.65 / (1 + gap * 0.25));
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
        const vol = Math.min(0.88, 0.72 / (1 + gap * 0.18));
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
      decodedVoices: this.buffers.size,
      decodedBgm: this.bgmBuffers.size,
      decodedSfx: this.sfxBuffers.size,
      liveSources: this.nodes.size,
    };
  }

  private async loadAllAssets(): Promise<void> {
    const context = this.context;
    if (!context) return;
    const decodeMap = async <K extends string>(entries: [K, string][], target: Map<K, AudioBuffer>, isVoice = false) => {
      await Promise.all(entries.map(async ([id, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          target.set(id, buffer);
        } catch {
          if (isVoice) this.issue = '部分语音加载失败，游戏仍可继续';
        }
      }));
    };
    await Promise.all([
      decodeMap(Object.entries(VOICE_URLS) as [VoiceId, string][], this.buffers, true),
      decodeMap(Object.entries(BGM_URLS) as [BgmId, string][], this.bgmBuffers),
      decodeMap(Object.entries(SFX_URLS) as [SfxId, string][], this.sfxBuffers),
    ]);
    this.ready = true;
  }

  private applyVolume(): void {
    if (this.context && this.master) this.master.gain.setValueAtTime(this.muted ? 0 : 0.62, this.context.currentTime);
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
    if (this.playSfx('doorOpen', 0.85)) return;
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
      if (this.currentVoice === source) this.currentVoice = null;
      if (this.currentBgm === source) {
        this.currentBgm = null;
        this.currentBgmId = null;
      }
    };
  }
}
