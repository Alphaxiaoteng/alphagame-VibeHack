import { describe, expect, it } from 'vitest';
import { DOORS, EXIT_APPROACH, GUARD_RADIUS, PLAYER_RADIUS, PLAYER_SPAWN } from '../src/core/config';
import { HospitalMap, distance, moveCircle } from '../src/core/map';
import type { DoorId, Point } from '../src/core/config';

const corners: Point[] = [
  { x: 4.5, z: 4.5 }, { x: 25.5, z: 4.5 },
  { x: 25.5, z: 17.5 }, { x: 4.5, z: 17.5 },
];

function expectUsablePath(map: HospitalMap, from: Point, to: Point) {
  const path = map.findPath(from, to, GUARD_RADIUS);
  expect(path.length).toBeGreaterThan(0);
  let previous = from;
  for (const point of path) {
    expect(map.canOccupy(point, GUARD_RADIUS)).toBe(true);
    expect(map.segmentClear(previous, point, GUARD_RADIUS)).toBe(true);
    previous = point;
  }
  expect(distance(previous, to)).toBeLessThan(0.01);
  return path;
}

describe('医院碰撞与导航使用同一地图', () => {
  it('出生点合法，中央建筑和走廊推床不是可穿过的装饰', () => {
    const map = new HospitalMap();
    expect(map.canOccupy(PLAYER_SPAWN, PLAYER_RADIUS)).toBe(true);
    expect(map.canOccupy({ x: 15, z: 11 }, PLAYER_RADIUS)).toBe(false);
    expect(map.canOccupy({ x: 19, z: 5.5 }, PLAYER_RADIUS)).toBe(false);
  });

  it('大幅移动也不能穿过中央墙体或外墙', () => {
    const map = new HospitalMap();
    const inner = moveCircle({ x: 4.5, z: 8 }, { x: 100, z: 0 }, PLAYER_RADIUS, map);
    const outer = moveCircle({ x: 4.5, z: 8 }, { x: -100, z: 0 }, PLAYER_RADIUS, map);
    expect(inner.x).toBeLessThanOrEqual(5.651);
    expect(outer.x).toBeGreaterThanOrEqual(3.349);
    expect(map.canOccupy(inner, PLAYER_RADIUS)).toBe(true);
    expect(map.canOccupy(outer, PLAYER_RADIUS)).toBe(true);
  });

  it('斜向撞墙仍沿墙滑动，不会把角色卡在墙中', () => {
    const map = new HospitalMap();
    const end = moveCircle({ x: 4.5, z: 8 }, { x: 4, z: 4 }, PLAYER_RADIUS, map);
    expect(end.x).toBeLessThanOrEqual(5.651);
    expect(end.z).toBeGreaterThan(11);
    expect(map.canOccupy(end, PLAYER_RADIUS)).toBe(true);
  });

  it('床和药柜同样阻挡实际移动', () => {
    const map = new HospitalMap();
    const end = moveCircle({ x: 19, z: 4.5 }, { x: 0, z: 2 }, PLAYER_RADIUS, map);
    expect(end.z).toBeLessThanOrEqual(4.751);
    expect(map.canOccupy(end, PLAYER_RADIUS)).toBe(true);
  });

  for (const closed of [null, 'A', 'B'] as const) {
    it(`防火门 ${closed ?? '全开'} 时四角、出生点和安全门触发区全部可达`, () => {
      const map = new HospitalMap();
      if (closed) expect(map.setDoor(closed, true)).toBe(true);
      for (const corner of corners) expectUsablePath(map, PLAYER_SPAWN, corner);
      expectUsablePath(map, PLAYER_SPAWN, EXIT_APPROACH);
    });
  }

  for (const id of ['A', 'B'] as DoorId[]) {
    it(`关闭门 ${id} 同时阻挡玩家和值班员，导航立即绕另一条长走廊`, () => {
      const map = new HospitalMap();
      const z = (DOORS[id].minZ + DOORS[id].maxZ) / 2;
      const from = { x: 14, z };
      const to = { x: 20, z };
      const direct = expectUsablePath(map, from, to);
      expect(direct.every(point => Math.abs(point.z - z) < 0.1)).toBe(true);
      expect(map.setDoor(id, true)).toBe(true);
      for (const radius of [PLAYER_RADIUS, GUARD_RADIUS]) {
        const end = moveCircle(from, { x: 5, z: 0 }, radius, map);
        expect(end.x).toBeLessThan(15 - radius);
      }
      const detour = expectUsablePath(map, from, to);
      expect(detour.some(point => id === 'A' ? point.z >= 16.5 : point.z <= 5.5)).toBe(true);
      expect(map.setDoor(id, false)).toBe(true);
      const reopened = expectUsablePath(map, from, to);
      expect(reopened.every(point => Math.abs(point.z - z) < 0.1)).toBe(true);
    });
  }

  it('两扇门不能同时关闭，拒绝操作不改变已关闭的门', () => {
    const map = new HospitalMap();
    expect(map.setDoor('A', true)).toBe(true);
    const revision = map.revision;
    expect(map.setDoor('B', true)).toBe(false);
    expect(map.closedDoor).toBe('A');
    expect(map.revision).toBe(revision);
  });

  it('门框一米内有角色时不落门，不挤压或传送角色', () => {
    const map = new HospitalMap();
    expect(map.setDoor('A', true, [{ x: 15.6, z: 4.5 }])).toBe(false);
    expect(map.closedDoor).toBeNull();
  });

  it('墙、家具和关闭的门遮挡视线', () => {
    const map = new HospitalMap();
    expect(map.hasLineOfSight({ x: 4.5, z: 11 }, { x: 25.5, z: 11 })).toBe(false);
    expect(map.hasLineOfSight({ x: 12, z: 4.5 }, { x: 18, z: 4.5 })).toBe(true);
    map.setDoor('A', true);
    expect(map.hasLineOfSight({ x: 14, z: 4.5 }, { x: 16, z: 4.5 })).toBe(false);
    expect(map.hasLineOfSight({ x: 19, z: 4.8 }, { x: 19, z: 5.95 })).toBe(false);
  });

  it('导航网格跟随地图版本重建，不随开关门次数无限累积', () => {
    const map = new HospitalMap();
    const first = map.findPath({ x: 4.5, z: 4.5 }, { x: 25.5, z: 17.5 }, GUARD_RADIUS);
    expect(first.length).toBeGreaterThan(0);
    map.setDoor('A', true);
    map.findPath({ x: 4.5, z: 4.5 }, { x: 25.5, z: 17.5 }, GUARD_RADIUS);
    map.setDoor('A', false);
    for (let round = 0; round < 50; round += 1) {
      map.setDoor('B', true);
      map.setDoor('B', false);
      map.findPath({ x: 4.5, z: 4.5 }, { x: 25.5, z: 17.5 }, GUARD_RADIUS);
    }
    // 两个半径（玩家/值班员）各至多缓存一份当前版本网格
    expect(map['gridCache'].size).toBeLessThanOrEqual(2);
    expect(map.findPath({ x: 4.5, z: 4.5 }, { x: 25.5, z: 17.5 }, GUARD_RADIUS).length).toBeGreaterThan(0);
  });
});
