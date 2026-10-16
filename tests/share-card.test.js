import test from 'node:test';
import assert from 'node:assert/strict';
import { createShareData } from '../src/share-card.js';

const baseline = {
    price: 123, currency: 'USD', rate: 6.6895, cycleDays: 365, cycleLabel: '年',
    tradeDate: '2026-10-16', dueDate: '2026-11-27', remainingValue: 123 / 365 * 42 * 6.6895,
    reference: { currency: 'USD', rate: 6.6895, date: '2026-10-16' },
};
const build = changes => createShareData({ ...baseline, ...changes });

test('报价、溢价与剩余价值按显示精度相加，保留人民币续费金额', () => {
    const card = build({ salePrice: 114.68 });
    assert.equal(card.values.sale, '114.68');
    assert.equal(card.values.remaining, '94.68');
    assert.equal(card.values.premium, '+ ¥20.00');
    assert.equal(card.values.renewal, '123.00 USD / 年');
    assert.equal(card.values.renewalCNY, '¥ 822.81');
    assert.equal(card.values.days, '42');
    assert.equal(card.values.percent, '11.5');
    assert.equal(card.values.periodDetail, '已使用 323 天');
    assert.equal(card.values.sourceDetail, '数据日期 2026-10-16');
});

test('未填写报价时使用剩余价值，并明确显示无溢价', () => {
    const card = build();
    assert.equal(card.values.sale, '94.68');
    assert.equal(card.values.premium, '¥0.00');
    assert.equal(card.values.premiumLabel, '无溢价');
    assert.equal(card.premiumTone, 'neutral');
});

test('直接填写交易总价后，折价金额与总价保持一致', () => {
    const card = build({ salePrice: 84.68 });
    assert.equal(card.values.premiumLabel, '折价');
    assert.equal(card.values.premium, '− ¥10.00');
    assert.equal(card.premiumTone, 'discount');
    assert.equal(build({ salePrice: 0 }).values.sale, '0.00');
});

test('月付、三年付和其他币种使用实际周期与单位', () => {
    const monthly = build({ currency: 'EUR', rate: 7.5, cycleDays: 30, cycleLabel: '月', dueDate: '2026-11-15', remainingValue: 922.5 });
    assert.equal(monthly.values.renewal, '123.00 EUR / 月');
    assert.equal(monthly.values.cycleDays, '30');
    assert.equal(monthly.values.percent, '100.0');
    const triennial = build({ currency: 'TWD', rate: 0.2062, cycleDays: 1095, cycleLabel: '三年' });
    assert.equal(triennial.values.renewal, '123.00 TWD / 三年');
    assert.equal(triennial.values.cycleDays, '1,095');
});

test('过期、临期、完整周期和超过一个周期的进度均有明确含义', () => {
    const expired = build({ dueDate: '2026-10-15', remainingValue: 0 });
    assert.equal(expired.progress, 0);
    assert.equal(expired.values.days, '0');
    const lastDay = build({ dueDate: '2026-10-17' });
    assert.ok(lastDay.progress > 0 && lastDay.progress < 1);
    assert.equal(lastDay.values.days, '1');
    const full = build({ dueDate: '2027-10-16' });
    assert.equal(full.progress, 100);
    assert.equal(full.values.periodDetail, '已使用 0 天');
    const extra = build({ dueDate: '2027-10-17' });
    assert.equal(extra.progress, 100);
    assert.equal(extra.values.percent, '100.3');
    assert.equal(extra.values.periodDetail, '超出本周期 1 天');
});

test('跨闰日和夏令时日期按完整日期计算天数', () => {
    assert.equal(build({ tradeDate: '2028-02-28', dueDate: '2028-03-01' }).values.days, '2');
    assert.equal(build({ tradeDate: '2026-03-07', dueDate: '2026-03-09' }).values.days, '2');
});

test('手动汇率不冒用 API 数据来源，人民币计价不假定外部来源', () => {
    const manual = build({ rate: 6.75 });
    assert.equal(manual.values.source, '自定义汇率');
    assert.equal(manual.values.rateLabel, '自定义汇率');
    assert.ok(!manual.values.sourceDetail.includes('2026-10-16'));
    const cny = build({ currency: 'CNY', rate: 1 });
    assert.equal(cny.values.source, '人民币计价');
    assert.equal(cny.values.original, '人民币报价');
    assert.equal(cny.values.renewalCNY, '¥ 123.00');
});

test('大额报价和极小汇率保持有效数值表示', () => {
    assert.equal(build({ price: 12345 }).values.renewalCNY, '¥ 82,581.88');
    assert.equal(build({ rate: 1e-9 }).values.rate, '1 USD = 1.0000e-9 CNY');
    assert.ok(build({ price: 1e22, remainingValue: 1e22 }).values.sale.includes('e+22'));
});

test('阻止缺失或无效日期、无效汇率和负交易总价导出', () => {
    for (const changes of [
        { tradeDate: '' }, { dueDate: '2026-02-30' }, { rate: 0 }, { rate: NaN },
        { price: -1 }, { remainingValue: Infinity }, { salePrice: -1 }, { cycleDays: 0 },
    ]) assert.throws(() => build(changes));
});
