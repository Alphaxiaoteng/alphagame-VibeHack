import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  PRODUCTS,
  SKINS,
  canPlayLevel,
  canUseSkin,
  commandCopyFor,
  isProductSku,
  productForLevel,
  productForSkin,
  resolveEntitlements,
  resolveSkin,
} from '../src/core/economy';
import { emptyLedger, grant, handleWebhook, ownedSkus, readLedger, readWaffoEnv, writeLedger } from '../src/server/waffo';
import type { WaffoEnv } from '../src/server/waffo';
import { RoundsGame } from '../src/core/state';

const ENV: WaffoEnv = { merchantId: 'MER_test', storeId: 'STO_test', privateKey: 'key', environment: 'test' };

describe('买断制商品目录', () => {
  it('SKU 唯一，且所有权益都指向真实存在的关卡与皮肤', () => {
    const skus = PRODUCTS.map(product => product.sku);
    expect(new Set(skus).size).toBe(skus.length);
    for (const product of PRODUCTS) {
      expect(isProductSku(product.sku)).toBe(true);
      // 金额必须是展示串（Waffo 要求 "0.99" 而不是 99 分）
      expect(product.price).toMatch(/^\d+\.\d{2}$/);
      expect(product.grants.levels.length + product.grants.skins.length).toBeGreaterThan(0);
      for (const level of product.grants.levels) expect(LEVELS.some(item => item.id === level)).toBe(true);
      for (const skin of product.grants.skins) expect(SKINS.some(item => item.id === skin)).toBe(true);
    }
  });

  it('全部是买断制：没有任何订阅商品，01 住院部免费', () => {
    expect(PRODUCTS.every(product => product.price.length > 0)).toBe(true);
    expect(LEVELS.filter(level => level.free).map(level => level.id)).toEqual(['ward-01']);
    expect(SKINS.filter(skin => skin.free).map(skin => skin.id)).toEqual(['standard']);
  });

  it('关卡之间只差规则数字，且都比免费关更紧或更长', () => {
    const [ward, dojo, vault] = LEVELS;
    expect(ward.rules).toEqual({ timeLimit: 45, commandCooldown: 12, patrolSpeed: 2.8 });
    expect(dojo.rules).toEqual({ timeLimit: 60, commandCooldown: 12, patrolSpeed: 3.2 });
    expect(vault.rules).toEqual({ timeLimit: 50, commandCooldown: 8, patrolSpeed: 3.0 });
    expect(dojo.rules.patrolSpeed).toBeGreaterThan(ward.rules.patrolSpeed);
    expect(vault.rules.commandCooldown).toBeLessThan(ward.rules.commandCooldown);
  });

  it('免费关是医院题材，付费关叠忍者据点题材，且每关都有指令说法', () => {
    expect(LEVELS.map(level => level.theme)).toEqual(['hospital', 'shinobi', 'shinobi']);
    // 换题材只换展示文案：时长/冷却/范围仍以 config 的 COMMANDS 为准
    expect(commandCopyFor('ward-01').lights.name).toBe('全院开灯');
    expect(commandCopyFor('dojo-02').lights.name).toBe('照明符');
    expect(commandCopyFor('vault-03').lockdown.name).toBe('岩壁封锁');
    expect(commandCopyFor('vault-03').broadcast.name).toBe('替身诱敌');
    // 关卡不存在时回落医院默认，保证 HUD 永远有字可写
    expect(commandCopyFor('not-a-level').lights.name).toBe('全院开灯');
  });
});

describe('权益折算', () => {
  it('未购买时只有免费关卡与标准皮肤可用', () => {
    const entitlements = resolveEntitlements([]);
    expect(canPlayLevel('ward-01', entitlements)).toBe(true);
    expect(canPlayLevel('dojo-02', entitlements)).toBe(false);
    expect(canUseSkin('standard', entitlements)).toBe(true);
    expect(canUseSkin('shinobi-indigo', entitlements)).toBe(false);
    expect(resolveSkin('dojo-02', entitlements).id).toBe('standard');
  });

  it('单买关卡只解锁该关卡，不动皮肤', () => {
    const entitlements = resolveEntitlements(['LEVEL_DOJO']);
    expect(canPlayLevel('dojo-02', entitlements)).toBe(true);
    expect(canPlayLevel('vault-03', entitlements)).toBe(false);
    // 皮肤是单独的商品，买关卡不会顺带送皮肤
    expect(canUseSkin('shinobi-indigo', entitlements)).toBe(false);
    expect(resolveSkin('dojo-02', entitlements).id).toBe('standard');
  });

  it('买了皮肤包后，对应关卡的推荐皮肤自动生效', () => {
    const entitlements = resolveEntitlements(['LEVEL_DOJO', 'SKIN_PACK']);
    expect(resolveSkin('dojo-02', entitlements).id).toBe('shinobi-indigo');
    expect(resolveSkin('vault-03', entitlements).id).toBe('scroll-vermilion');
    expect(resolveSkin('ward-01', entitlements).id).toBe('standard');
  });

  it('全院解锁包一次给到全部付费内容', () => {
    const entitlements = resolveEntitlements(['BUNDLE_ALL']);
    expect(canPlayLevel('dojo-02', entitlements)).toBe(true);
    expect(canPlayLevel('vault-03', entitlements)).toBe(true);
    expect(canUseSkin('shinobi-indigo', entitlements)).toBe(true);
    expect(canUseSkin('scroll-vermilion', entitlements)).toBe(true);
  });

  it('未知 SKU 与重复 SKU 都被安全处理：目录下架旧商品不该让老玩家权益崩掉', () => {
    const entitlements = resolveEntitlements(['LEVEL_DOJO', 'LEVEL_DOJO', 'LEGACY_PACK', '']);
    expect(entitlements.skus).toEqual(['LEVEL_DOJO']);
    expect(entitlements.levels).toEqual(['dojo-02']);
    expect(canPlayLevel('ward-01', entitlements)).toBe(true);
  });

  it('不存在的关卡/皮肤一律判定为不可用', () => {
    const entitlements = resolveEntitlements(['BUNDLE_ALL']);
    expect(canPlayLevel('not-a-level', entitlements)).toBe(false);
    expect(canUseSkin('not-a-skin', entitlements)).toBe(false);
  });

  it('锁定项能找到对应的买断商品，且免费项没有可卖的商品', () => {
    expect(productForLevel('dojo-02')?.sku).toBe('LEVEL_DOJO');
    expect(productForLevel('vault-03')?.sku).toBe('LEVEL_VAULT');
    expect(productForSkin('shinobi-indigo')?.sku).toBe('SKIN_PACK');
    expect(productForSkin('scroll-vermilion')?.sku).toBe('SKIN_PACK');
    expect(productForLevel('ward-01')).toBeUndefined();
    expect(productForSkin('standard')).toBeUndefined();
  });
});

describe('关卡规则注入', () => {
  it('切换科室会同步时长、冷却与巡逻速度，重开后按新时长计时', () => {
    const game = new RoundsGame({ perception: false });
    expect(game.rules).toEqual(LEVELS[0].rules);
    expect(game.guard.patrolSpeed).toBe(LEVELS[0].rules.patrolSpeed);

    const vault = LEVELS[2];
    game.applyLevelRules(vault.rules);
    expect(game.guard.patrolSpeed).toBe(3.0);
    game.start();
    expect(game.remaining).toBe(50);

    // 计时按新时长走：50 秒关跑满 5 秒后应剩 45 秒（仍是 45 秒关的话这里会是 40）。
    for (let frame = 0; frame < 300; frame++) game.tick(1 / 60);
    expect(game.remaining).toBeCloseTo(45, 3);
  });
});

describe('账本与幂等入账', () => {
  it('同一 ref 重复购买同一 SKU 不产生重复权益', () => {
    const ledger = emptyLedger();
    expect(grant(ledger, 'p_0123456789abcdef', 'LEVEL_DOJO')).toBe(true);
    expect(grant(ledger, 'p_0123456789abcdef', 'LEVEL_DOJO')).toBe(false);
    expect(grant(ledger, 'p_0123456789abcdef', 'BUNDLE_ALL')).toBe(true);
    expect(ownedSkus(ledger, 'p_0123456789abcdef')).toEqual(['LEVEL_DOJO', 'BUNDLE_ALL']);
    expect(ownedSkus(ledger, 'p_ffffffffffffffff')).toEqual([]);
  });

  it('账本可落盘再读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'waffo-ledger-'));
    try {
      const path = join(dir, 'nested', '.waffo-ledger.json');
      const ledger = emptyLedger();
      grant(ledger, 'p_0123456789abcdef', 'SKIN_PACK');
      ledger.handledEvents.push('evt-1');
      ledger.products = { LEVEL_DOJO: 'PROD_1' };
      writeLedger(path, ledger);
      expect(readLedger(path)).toEqual(ledger);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('账本缺失或损坏时从空账本继续，而不是让收款链路报错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'waffo-broken-'));
    try {
      expect(readLedger(join(dir, 'missing.json'))).toEqual(emptyLedger());
      const path = join(dir, 'broken.json');
      writeLedger(path, emptyLedger());
      writeFileSync(path, '{ not json');
      expect(readLedger(path)).toEqual(emptyLedger());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Webhook 校验', () => {
  it('没有签名头一律拒绝', () => {
    const outcome = handleWebhook('{"id":"x"}', undefined, ENV, emptyLedger());
    expect(outcome.status).toBe(400);
    expect(String(outcome.body.error)).toContain('X-Waffo-Signature');
  });

  it('签名头格式不对一律拒绝', () => {
    const outcome = handleWebhook('{"id":"x"}', 'garbage', ENV, emptyLedger());
    expect(outcome.status).toBe(400);
    expect(String(outcome.body.error)).toContain('Malformed');
  });

  it('签名对不上时拒绝，且不写入任何权益', () => {
    const ledger = emptyLedger();
    const signature = `t=${Date.now()},v1=${'a'.repeat(64)}`;
    const outcome = handleWebhook(JSON.stringify({ id: 'evt', eventType: 'order.completed' }), signature, ENV, ledger);
    expect(outcome.status).toBe(400);
    expect(ledger.purchases).toEqual({});
    expect(ledger.handledEvents).toEqual([]);
  });
});

describe('Waffo 环境变量', () => {
  it('缺关键变量时启动即报错，不静默降级', () => {
    expect(() => readWaffoEnv({ WAFFO_MERCHANT_ID: 'MER_x' })).toThrow(/WAFFO_STORE_ID/);
  });

  it('还原 .env 里的 \\n 转义私钥，并校验环境取值', () => {
    const env = readWaffoEnv({
      WAFFO_MERCHANT_ID: 'MER_x',
      WAFFO_STORE_ID: 'STO_x',
      WAFFO_PRIVATE_KEY: '-----BEGIN\\nMID\\n-----END',
    });
    expect(env.environment).toBe('test');
    expect(env.privateKey).toContain('\n');
    expect(() => readWaffoEnv({
      WAFFO_MERCHANT_ID: 'MER_x',
      WAFFO_STORE_ID: 'STO_x',
      WAFFO_PRIVATE_KEY: 'k',
      WAFFO_ENV: 'staging',
    })).toThrow(/test 或 prod/);
  });
});
