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

/** 用户点击开始后才建立 AudioContext；没有网络接口、运行时 TTS 或密钥。 */
export class AudioEngine {
  muted = false;
  ready = false;
  issue = '';
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<VoiceId, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private nodes = new Set<AudioScheduledSourceNode>();
  private currentVoice: AudioBufferSourceNode | null = null;
  private generation = 0;
  private active = false;
  private paused = false;
  private nextPlayerStep = 0;
  private nextGuardStep = 0;
  private nextBellStep = 0;
  private lastPlayer: Point | null = null;
  private lastGuard: Point | null = null;
  private patrolSpoken = false;

  startRound(): void {
    this.stopRound();
    this.active = true;
    this.paused = false;
    this.nextPlayerStep = 0;
    this.nextGuardStep = 0;
    this.nextBellStep = 0;
    this.lastPlayer = null;
    this.lastGuard = null;
    this.patrolSpoken = false;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }
      this.applyVolume();
      void this.context.resume().catch(() => { this.issue = '声音未能启动，游戏仍可继续'; });
      this.startHum();
      if (!this.loading) this.loading = this.loadVoices();
      this.voice('start');
    } catch {
      this.issue = '此浏览器无法启用声音，游戏仍可继续';
    }
  }

  stopRound(): void {
    this.generation += 1;
    this.active = false;
    for (const node of this.nodes) {
      try { node.stop(); } catch { /* 已结束的短音源无需再次停止 */ }
    }
    this.nodes.clear();
    this.currentVoice = null;
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
      source.buffer = buffer;
      source.connect(this.master);
      this.track(source);
      this.currentVoice = source;
      source.start();
    };
    if (this.ready) play();
    else void this.loading?.then(play);
  }

  doorSound(): void {
    this.tone(85, 0.22, 0.17, 'triangle');
    this.tone(160, 0.11, 0.09, 'triangle');
  }

  /** 门重开：上升双音金属，比落门轻，形成“落下-升起”的配对反馈。 */
  doorOpenSound(): void {
    this.tone(150, 0.1, 0.09, 'triangle');
    this.tone(230, 0.16, 0.06, 'triangle');
  }

  /** 开灯：继电器咔哒两声，替代通用提示音，让“合闸”有实感。 */
  lightSwitch(): void {
    this.tone(1900, 0.022, 0.07, 'square');
    this.tone(1400, 0.03, 0.05, 'square');
  }

  /** 广播前的 PA 提示短叮：先引人注意，语音随后接入。 */
  paDing(): void {
    this.tone(660, 0.09, 0.075, 'sine');
    this.tone(880, 0.14, 0.055, 'sine');
  }

  alert(): void {
    this.tone(420, 0.16, 0.09, 'triangle');
    this.tone(600, 0.19, 0.045, 'sine');
  }

  chime(): void {
    this.tone(523.25, 0.24, 0.11);
    this.tone(659.25, 0.34, 0.07);
    this.tone(783.99, 0.4, 0.055);
  }

  update(game: RoundsGame): void {
    if (!this.active || this.paused || game.phase !== 'playing') return;
    const moved = this.lastPlayer ? distance(this.lastPlayer, game.player.position) > 0.002 : false;
    const guardMoved = this.lastGuard ? distance(this.lastGuard, game.guard.position) > 0.002 : false;
    if (moved && game.elapsed >= this.nextPlayerStep) {
      this.tone(game.player.sprinting ? 118 : 100, 0.075, 0.075);
      this.nextPlayerStep = game.elapsed + (game.player.sprinting ? 0.25 : 0.4);
    }
    const gap = distance(game.player.position, game.guard.position);
    // 脚步与追逐铃都按秒表排程，不靠逐帧计数，掉帧时节奏也不漂。
    if (guardMoved && game.elapsed >= this.nextGuardStep) {
      const wait = secondsUntilFootstep(game.elapsed, game.guard.mode, gap);
      if (wait !== Infinity) {
        this.tone(70, 0.1, 0.1 / (1 + gap * 0.35));
        this.nextGuardStep = game.elapsed + wait;
      } else {
        this.nextGuardStep = game.elapsed + 0.2;
      }
    }
    if (game.elapsed >= this.nextBellStep) {
      const wait = secondsUntilGuardBell(game.elapsed, game.guard.mode, gap);
      if (wait !== Infinity) {
        this.tone(880, 0.06, 0.05, 'square');
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
    return { ready: this.ready, muted: this.muted, issue: this.issue, context: this.context?.state ?? 'not-started', decodedVoices: this.buffers.size, liveSources: this.nodes.size };
  }

  private async loadVoices(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await Promise.all(Object.entries(VOICE_URLS).map(async ([id, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(id as VoiceId, buffer);
      } catch {
        this.issue = '部分语音加载失败，游戏仍可继续';
      }
    }));
    this.ready = true;
  }

  private applyVolume(): void {
    if (this.context && this.master) this.master.gain.setValueAtTime(this.muted ? 0 : 0.32, this.context.currentTime);
  }

  /** 医院底噪两层：空调低频隆隆 + 荧光灯镇流器嗡鸣，远低于一切操作反馈。 */
  private startHum(): void {
    if (!this.context || !this.master) return;
    const rumble = this.context.createOscillator();
    const rumbleGain = this.context.createGain();
    rumble.frequency.value = 58;
    rumbleGain.gain.value = 0.011;
    rumble.connect(rumbleGain);
    rumbleGain.connect(this.master);
    this.track(rumble);
    rumble.start();
    const buzz = this.context.createOscillator();
    const buzzGain = this.context.createGain();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 119;
    buzzGain.gain.value = 0.0035;
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
    const now = this.context.currentTime;
    
    // 1. 锁扣解开的清脆金属重音
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

    // 2. 厚重钢门向外推开的低沉门轴共鸣音
    const swingOsc = this.context.createOscillator();
    const swingGain = this.context.createGain();
    swingOsc.type = 'sine';
    swingOsc.frequency.setValueAtTime(95, now + 0.05);
    swingOsc.frequency.linearRampToValueAtTime(145, now + 0.6);
    swingOsc.frequency.exponentialRampToValueAtTime(65, now + 1.2);
    swingGain.gain.setValueAtTime(0.001, now + 0.05);
    swingGain.gain.linearRampToValueAtTime(0.22, now + 0.25);
    swingGain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
    swingOsc.connect(swingGain);
    swingGain.connect(this.master);
    this.track(swingOsc);
    swingOsc.start(now + 0.05);
    swingOsc.stop(now + 1.35);
  }

  private track(source: AudioScheduledSourceNode): void {
    this.nodes.add(source);
    source.onended = () => {
      this.nodes.delete(source);
      source.disconnect();
      if (this.currentVoice === source) this.currentVoice = null;
    };
  }
}
