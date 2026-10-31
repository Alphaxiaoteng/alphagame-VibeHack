import {
  CURTAIN_RECTS,
  DOORS,
  DOOR_CLEARANCE,
  FURNITURE_RECTS,
  MAP_DEPTH,
  MAP_WIDTH,
  WALKABLE_RECTS,
} from './config';
import type { DoorId, Point, Rect } from './config';

const EPS = 1e-9;
const SAMPLE_STEP = 0.08;
const CELL = 0.25;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pointInRect(p: Point, rect: Rect): boolean {
  return p.x >= rect.minX && p.x <= rect.maxX && p.z >= rect.minZ && p.z <= rect.maxZ;
}

function overlapsRect(p: Point, radius: number, rect: Rect): boolean {
  if (radius <= 0) return pointInRect(p, rect);
  const dx = p.x - Math.max(rect.minX, Math.min(p.x, rect.maxX));
  const dz = p.z - Math.max(rect.minZ, Math.min(p.z, rect.maxZ));
  return dx * dx + dz * dz < radius * radius;
}

function insideRect(p: Point, radius: number, rect: Rect): boolean {
  return (
    p.x - radius >= rect.minX - EPS &&
    p.x + radius <= rect.maxX + EPS &&
    p.z - radius >= rect.minZ - EPS &&
    p.z + radius <= rect.maxZ + EPS
  );
}

interface NavGrid {
  cols: number;
  rows: number;
  walkable: Uint8Array;
  revision: number;
}

interface NodeIndex {
  i: number;
  j: number;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** 惰性删除的二叉最小堆 */
class MinHeap {
  private items: number[] = [];
  private priority: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, value: number): void {
    this.items.push(item);
    this.priority.push(value);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priority[parent] <= this.priority[index]) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): number {
    if (this.items.length === 0) return -1;
    const top = this.items[0];
    const lastItem = this.items.pop() as number;
    const lastPriority = this.priority.pop() as number;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priority[0] = lastPriority;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.priority[left] < this.priority[smallest]) smallest = left;
        if (right < this.items.length && this.priority[right] < this.priority[smallest]) smallest = right;
        if (smallest === index) break;
        this.swap(smallest, index);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priority[a], this.priority[b]] = [this.priority[b], this.priority[a]];
  }
}

/**
 * 碰撞、视线与导航共用同一份地图数据：
 * 可通行区 = WALKABLE_RECTS 的并集，减去掩体与关闭的防火门。
 */
export class HospitalMap {
  closedDoor: DoorId | null = null;
  revision = 0;

  private gridCache = new Map<number, NavGrid>();

  canOccupy(p: Point, radius: number): boolean {
    if (!WALKABLE_RECTS.some(rect => insideRect(p, radius, rect))) return false;
    if (FURNITURE_RECTS.some(rect => overlapsRect(p, radius, rect))) return false;
    if (this.closedDoor && overlapsRect(p, radius, DOORS[this.closedDoor])) return false;
    return true;
  }

  /** 半径 0 的可占位判定即「这个点是不是实体」 */
  isSolidPoint(p: Point): boolean {
    return !this.canOccupy(p, 0);
  }

  hasLineOfSight(a: Point, b: Point): boolean {
    // 隔帘只挡视线（radius 0 的视线检测），不挡移动与寻路
    return this.clearSegment(a, b, 0) && !this.crossesCurtain(a, b);
  }

  /** 线段是否穿过医用隔帘（点到矩形距离 < 0.05 即视为穿过） */
  private crossesCurtain(a: Point, b: Point): boolean {
    const length = distance(a, b);
    const steps = Math.max(1, Math.ceil(length / 0.1));
    for (let step = 0; step <= steps; step += 1) {
      const t = steps === 0 ? 0 : step / steps;
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (CURTAIN_RECTS.some(rect => pointInRect(point, rect))) return true;
    }
    return false;
  }

  segmentClear(a: Point, b: Point, radius: number): boolean {
    return this.clearSegment(a, b, radius);
  }

  canCloseDoor(id: DoorId, occupied: readonly Point[] = []): boolean {
    if (this.closedDoor !== null) return false;
    const door = DOORS[id];
    return !occupied.some(p => {
      const dx = p.x - Math.max(door.minX, Math.min(p.x, door.maxX));
      const dz = p.z - Math.max(door.minZ, Math.min(p.z, door.maxZ));
      return Math.hypot(dx, dz) <= DOOR_CLEARANCE;
    });
  }

  /** 关门成功返回 true；已有门关闭、门框被占用或状态未变返回 false */
  setDoor(id: DoorId, close: boolean, occupied: readonly Point[] = []): boolean {
    if (close) {
      if (!this.canCloseDoor(id, occupied)) return false;
      this.closedDoor = id;
      this.revision += 1;
      return true;
    }
    if (this.closedDoor !== id) return false;
    this.closedDoor = null;
    this.revision += 1;
    return true;
  }

  openAll(): void {
    if (this.closedDoor === null) return;
    this.closedDoor = null;
    this.revision += 1;
  }

  /**
   * 返回从 from 到 to 的折线（不含 from，最后一点等于 to）。
   * 不可达时返回空数组。
   */
  findPath(from: Point, to: Point, radius: number): Point[] {
    if (!this.canOccupy(from, radius) || !this.canOccupy(to, radius)) return [];
    if (this.clearSegment(from, to, radius)) return [{ x: to.x, z: to.z }];

    const grid = this.grid(radius);
    const start = this.nearestNode(from, grid);
    const goal = this.nearestNode(to, grid);
    if (!start || !goal) return [];

    const nodes = this.astar(start, goal, grid);
    if (nodes.length === 0) return [];

    const points = nodes.map(node => ({ x: node.i * CELL, z: node.j * CELL }));
    const smoothed: Point[] = [];
    let anchor = from;
    let index = 0;
    while (index < points.length) {
      let far = points.length - 1;
      while (far > index && !this.clearSegment(anchor, points[far], radius)) far -= 1;
      smoothed.push(points[far]);
      anchor = points[far];
      index = far + 1;
    }
    if (!this.clearSegment(anchor, to, radius)) return [];
    if (distance(smoothed[smoothed.length - 1], to) > EPS) smoothed.push({ x: to.x, z: to.z });
    else smoothed[smoothed.length - 1] = { x: to.x, z: to.z };
    return smoothed;
  }

  /** 玩家与 AI 半径不同：玩家贴墙时，AI 去最近的合法位置而不是卡在空路线。 */
  closestWalkable(point: Point, radius: number): Point | null {
    if (this.canOccupy(point, radius)) return { ...point };
    const node = this.nearestNode(point, this.grid(radius));
    return node ? { x: node.i * CELL, z: node.j * CELL } : null;
  }

  /** 按从起点到终点的顺序，返回真实路线穿过的预设防火门。 */
  doorsOnPath(start: Point, path: readonly Point[]): DoorId[] {
    const result: DoorId[] = [];
    let previous = start;
    for (const next of path) {
      for (const id of ['A', 'B'] as const) {
        const door = DOORS[id];
        const dx = next.x - previous.x;
        if (Math.abs(dx) < EPS) continue;
        const t = (door.center.x - previous.x) / dx;
        const z = previous.z + (next.z - previous.z) * t;
        if (t >= 0 && t <= 1 && z >= door.minZ && z <= door.maxZ && !result.includes(id)) result.push(id);
      }
      previous = next;
    }
    return result;
  }

  private clearSegment(a: Point, b: Point, radius: number): boolean {
    const length = distance(a, b);
    if (length < EPS) return true;
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (!this.canOccupy(point, radius)) return false;
    }
    return true;
  }

  private grid(radius: number): NavGrid {
    // 只保留当前地图版本的网格：开关门与重开都会推高 revision，
    // 旧网格不再有用，留着只会在多局累计后常驻内存（真实泄漏）。
    const cached = this.gridCache.get(radius);
    if (cached && cached.revision === this.revision) return cached;
    if (cached) this.gridCache.delete(radius);
    const cols = Math.round(MAP_WIDTH / CELL) + 1;
    const rows = Math.round(MAP_DEPTH / CELL) + 1;
    const walkable = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        walkable[j * cols + i] = this.canOccupy({ x: i * CELL, z: j * CELL }, radius) ? 1 : 0;
      }
    }
    const grid: NavGrid = { cols, rows, walkable, revision: this.revision };
    this.gridCache.set(radius, grid);
    return grid;
  }

  private nearestNode(point: Point, grid: NavGrid): NodeIndex | null {
    const baseI = Math.round(point.x / CELL);
    const baseJ = Math.round(point.z / CELL);
    for (let ring = 0; ring <= 24; ring += 1) {
      let best: NodeIndex | null = null;
      let bestDistance = Infinity;
      for (let dj = -ring; dj <= ring; dj += 1) {
        for (let di = -ring; di <= ring; di += 1) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = baseI + di;
          const j = baseJ + dj;
          if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
          if (!grid.walkable[j * grid.cols + i]) continue;
          const d = distance(point, { x: i * CELL, z: j * CELL });
          if (d < bestDistance) {
            bestDistance = d;
            best = { i, j };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  private heuristic(a: NodeIndex, b: NodeIndex): number {
    return Math.hypot(a.i - b.i, a.j - b.j);
  }

  private astar(start: NodeIndex, goal: NodeIndex, grid: NavGrid): NodeIndex[] {
    const { cols, rows, walkable } = grid;
    const total = cols * rows;
    const gScore = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const startIndex = start.j * cols + start.i;
    const goalIndex = goal.j * cols + goal.i;
    const open = new MinHeap();
    gScore[startIndex] = 0;
    open.push(startIndex, this.heuristic(start, goal));

    while (open.size > 0) {
      const current = open.pop();
      if (current < 0) break;
      if (current === goalIndex) break;
      if (closed[current]) continue;
      closed[current] = 1;
      const ci = current % cols;
      const cj = (current - ci) / cols;
      for (const [di, dj, cost] of NEIGHBORS) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const index = nj * cols + ni;
        if (!walkable[index] || closed[index]) continue;
        if (di !== 0 && dj !== 0) {
          if (!walkable[cj * cols + ni] || !walkable[nj * cols + ci]) continue;
        }
        const tentative = gScore[current] + cost;
        if (tentative < gScore[index]) {
          gScore[index] = tentative;
          cameFrom[index] = current;
          open.push(index, tentative + this.heuristic({ i: ni, j: nj }, goal));
        }
      }
    }

    if (startIndex !== goalIndex && cameFrom[goalIndex] === -1) return [];
    const reversed: NodeIndex[] = [];
    let cursor = goalIndex;
    for (;;) {
      reversed.push({ i: cursor % cols, j: Math.floor(cursor / cols) });
      if (cursor === startIndex) break;
      cursor = cameFrom[cursor];
      if (cursor < 0) return [];
    }
    return reversed.reverse();
  }
}

/** 让圆沿直线尽量推进，撞到墙体或家具时沿墙滑动，绝不穿墙 */
export function moveCircle(from: Point, delta: Point, radius: number, map: HospitalMap): Point {
  const length = Math.hypot(delta.x, delta.z);
  if (length < EPS) return { x: from.x, z: from.z };
  let { x, z } = from;
  const steps = Math.max(1, Math.ceil(length / 0.02));
  const stepX = delta.x / steps;
  const stepZ = delta.z / steps;
  for (let step = 0; step < steps; step += 1) {
    if (stepX !== 0 && map.canOccupy({ x: x + stepX, z }, radius)) x += stepX;
    if (stepZ !== 0 && map.canOccupy({ x, z: z + stepZ }, radius)) z += stepZ;
  }
  return { x, z };
}
