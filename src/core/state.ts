import {
  CATCH_RADIUS,
  COMMANDS,
  COMMAND_COOLDOWN,
  COMMAND_IDS,
  EXIT_POINT,
  EXIT_TRIGGER_RADIUS,
  GUARD_RADIUS,
  LIT_SIGHT_RANGE,
  MAX_STEP,
  NO_INPUT,
  SIGHT_RANGE,
  TIME_LIMIT,
  WARD_TARGETS,
} from './config';
import type { CommandId, DoorId, PlayerInput, Point } from './config';
import { HospitalMap, distance } from './map';
import { Player } from './player';
import { Warden } from './warden';

export type Phase = 'start' | 'playing' | 'paused' | 'won' | 'lost';

export type GameEventType =
  | 'started'
  | 'warning30'
  | 'warning10'
  | 'exitUnlocked'
  | 'caught'
  | 'won'
  | 'doorClosed'
  | 'doorOpened'
  | 'doorBlocked'
  | 'commandStarted'
  | 'commandEnded'
  | 'commandRejected'
  | 'guardChanged';

export interface GameEvent {
  type: GameEventType;
  door?: DoorId;
  command?: CommandId;
  message?: string;
}

export interface CommandEffect {
  id: CommandId;
  remaining: number;
  door?: DoorId;
  target?: Point;
}

export interface CommandStatus {
  cooldown: number;
  available: boolean;
  reason: string;
}

/**
 * 只保存规则与状态，不依赖 Three.js / DOM。
 * 渲染与声音从这里的公开状态读取结果，因此测试可以直接驱动同一套规则。
 */
export class RoundsGame {
  readonly map = new HospitalMap();
  readonly player = new Player();
  readonly guard: Warden;
  phase: Phase = 'start';
  elapsed = 0;
  activeEffect: CommandEffect | null = null;
  commandsUsed = 0;
  private cooldowns: Record<CommandId, number> = { lights: 0, lockdown: 0, broadcast: 0 };

  private events: GameEvent[] = [];
  private warned30 = false;
  private warned10 = false;
  private exitAnnounced = false;

  constructor(options: { perception?: boolean } = {}) {
    this.guard = new Warden(this.map, options.perception ?? true);
  }

  get lightsOn(): boolean {
    return this.activeEffect?.id === 'lights';
  }

  get sightRange(): number {
    return this.lightsOn ? LIT_SIGHT_RANGE : SIGHT_RANGE;
  }

  get remaining(): number {
    const raw = Math.max(0, TIME_LIMIT - this.elapsed);
    if (raw < 0.0005) return 0;
    return Math.round(raw * 1000) / 1000;
  }

  get exitUnlocked(): boolean {
    return this.remaining <= 0;
  }

  start(): void {
    this.resetRound();
    this.phase = 'playing';
    this.events.push({ type: 'started' });
  }

  restart(): void {
    this.start();
  }

  pause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume(): void {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  tick(rawDt: number, input: PlayerInput = NO_INPUT): void {
    if (this.phase !== 'playing') return;
    if (!Number.isFinite(rawDt) || rawDt <= 0) return;
    const dt = Math.min(rawDt, MAX_STEP);
    this.elapsed += dt;
    this.announceTime();
    this.updateCommands(dt);
    this.player.update(dt, input, this.map);
    const previousMode = this.guard.mode;
    this.guard.update(dt, this.map, this.player, this.sightRange);
    if (this.guard.mode !== previousMode) {
      this.events.push({ type: 'guardChanged', message: {
        patrol: '巡查恢复，留意走廊里的脚步',
        chase: '被发现了！转进病房、药房或屏风后，或封门拉开距离',
        search: '已丢失你的踪迹，正在搜索最后发现的位置',
        broadcast: '值班员正前往病房核查广播',
      }[this.guard.mode] });
    }

    // 规格：同一更新里既被抓又到门，先判抓到
    if (this.canCatchPlayer()) {
      this.phase = 'lost';
      this.events.push({ type: 'caught' });
      return;
    }
    if (this.exitUnlocked && distance(this.player.position, EXIT_POINT) <= EXIT_TRIGGER_RADIUS) {
      this.phase = 'won';
      this.events.push({ type: 'won' });
    }
  }

  canCatchPlayer(): boolean {
    if (distance(this.player.position, this.guard.position) > CATCH_RADIUS) return false;
    return this.map.hasLineOfSight(this.player.position, this.guard.position);
  }

  /** 调试/第一阶段测试用：直接开合防火门 */
  setDoor(id: DoorId, close: boolean): boolean {
    const occupied = [this.player.position, this.guard.position];
    const changed = this.map.setDoor(id, close, close ? occupied : []);
    if (!changed && close) {
      this.events.push({ type: 'doorBlocked', door: id });
      return false;
    }
    if (changed) {
      this.guard.replan(this.map);
      this.events.push({ type: close ? 'doorClosed' : 'doorOpened', door: id });
    }
    return changed;
  }

  commandStatus(id: CommandId): CommandStatus {
    const cooldown = this.cooldowns[id];
    let reason = '';
    if (this.phase !== 'playing') reason = this.phase === 'paused' ? '已暂停' : '开始后可用';
    else if (this.activeEffect) reason = this.activeEffect.id === id ? `生效 ${Math.ceil(this.activeEffect.remaining)}s` : '其他指令生效中';
    else if (cooldown > 0) reason = `冷却 ${Math.ceil(cooldown)}s`;
    else if (id === 'broadcast' && this.guard.perception && this.guard.canSeePlayer(this.map, this.player, this.sightRange)) reason = '先躲开视线';
    return { cooldown, available: !reason, reason };
  }

  useCommand(id: CommandId): boolean {
    const status = this.commandStatus(id);
    if (!status.available) {
      this.events.push({ type: 'commandRejected', command: id, message: status.reason === '先躲开视线' ? '被盯着，广播无法引开。先绕过墙角！' : status.reason });
      return false;
    }
    const effect: CommandEffect = { id, remaining: COMMANDS[id].duration };
    if (id === 'lockdown') {
      const destination = this.map.closestWalkable(this.player.position, GUARD_RADIUS);
      const path = destination ? this.map.findPath(this.guard.position, destination, GUARD_RADIUS) : [];
      const doors = this.map.doorsOnPath(this.guard.position, path);
      const chosen = doors.find(door => this.map.canCloseDoor(door, [this.player.position, this.guard.position]));
      if (!chosen || !this.setDoor(chosen, true)) {
        this.events.push({ type: 'commandRejected', command: id, message: '当前无法封锁通道：最短路线没有空闲防火门' });
        return false;
      }
      effect.door = chosen;
    } else if (id === 'broadcast') {
      const target = [...WARD_TARGETS]
        .sort((a, b) => distance(this.player.position, b) - distance(this.player.position, a))
        .find(point => this.map.findPath(this.guard.position, point, GUARD_RADIUS).length > 0);
      if (!target) {
        this.events.push({ type: 'commandRejected', command: id, message: '病房目前不可达，广播未发动' });
        return false;
      }
      effect.target = { ...target };
      this.guard.beginBroadcast(target, this.map);
    }
    this.cooldowns[id] = COMMAND_COOLDOWN;
    this.activeEffect = effect;
    this.commandsUsed += 1;
    this.events.push({ type: 'commandStarted', command: id, message: {
      lights: '全院开灯 · 出口路线亮起，但值班员看得更远',
      lockdown: `防火门 ${effect.door ?? ''} 关闭 · 双方都需要绕路`,
      broadcast: `病房广播响起 · 值班员正赶往${(effect.target?.x ?? 15) > 15 ? '东' : '西'}侧病房核查，之后搜查更严`,
    }[id] });
    return true;
  }

  private updateCommands(dt: number): void {
    for (const id of COMMAND_IDS) {
      const next = this.cooldowns[id] - dt;
      this.cooldowns[id] = next < 1e-6 ? 0 : next;
    }
    const effect = this.activeEffect;
    if (!effect) return;
    effect.remaining = Math.max(0, effect.remaining - dt);
    if (effect.remaining > 1e-6) return;
    this.activeEffect = null;
    if (effect.id === 'lockdown' && effect.door) this.setDoor(effect.door, false);
    if (effect.id === 'broadcast') this.guard.endBroadcast(this.map);
    this.events.push({ type: 'commandEnded', command: effect.id });
  }

  /** 仅 ?debug=1 使用：把剩余时间改写成指定值，不替代到门口获胜 */
  debugSetRemaining(value: number): void {
    this.elapsed = Math.max(0, Math.min(TIME_LIMIT, TIME_LIMIT - value));
    const left = this.remaining;
    if (left <= 30) this.warned30 = true;
    if (left <= 10) this.warned10 = true;
    if (left <= 0) this.exitAnnounced = true;
  }

  drainEvents(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  private announceTime(): void {
    const left = this.remaining;
    if (!this.warned30 && left <= 30) {
      this.warned30 = true;
      this.events.push({ type: 'warning30' });
    }
    if (!this.warned10 && left <= 10) {
      this.warned10 = true;
      this.events.push({ type: 'warning10' });
    }
    if (!this.exitAnnounced && left <= 0) {
      this.exitAnnounced = true;
      this.events.push({ type: 'exitUnlocked' });
    }
  }

  private resetRound(): void {
    this.elapsed = 0;
    this.events = [];
    this.warned30 = false;
    this.warned10 = false;
    this.exitAnnounced = false;
    this.activeEffect = null;
    this.commandsUsed = 0;
    for (const id of COMMAND_IDS) this.cooldowns[id] = 0;
    this.map.openAll();
    this.player.reset();
    this.guard.reset(this.map);
    // 开局宽限只属于“新一局”：resetRound 之外的 guard.reset（测试中途复位）不享有。
    this.guard.beginGrace();
  }
}
