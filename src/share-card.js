const CARD_WIDTH = 760;
const CARD_HEIGHT = 980;
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
let rendererPromise;

export function preloadShareCard() {
    if (!rendererPromise) {
        rendererPromise = import('html-to-image').catch(error => {
            rendererPromise = undefined;
            throw error;
        });
    }
    return rendererPromise;
}

function dateValue(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}

function formatMoney(value) {
    return Math.abs(value) >= 1e21 ? value.toExponential(4) : money.format(value);
}

export function createShareData(input) {
    const { price, currency, rate, cycleDays, cycleLabel, tradeDate, dueDate, remainingValue, reference } = input;
    const trade = dateValue(tradeDate);
    const due = dateValue(dueDate);
    if (!Number.isFinite(trade) || !Number.isFinite(due)) throw new Error('请先填写有效的交易日期和到期日期');
    if (![price, rate, cycleDays, remainingValue, price * rate].every(Number.isFinite)
        || price < 0 || rate <= 0 || cycleDays <= 0 || remainingValue < 0) {
        throw new Error('请先填写有效的续费价格和汇率');
    }
    const remaining = Number(remainingValue.toFixed(2));
    const sale = Number((input.salePrice ?? remainingValue).toFixed(2));
    if (!Number.isFinite(sale) || sale < 0 || !Number.isFinite(sale / rate)) throw new Error('交易总价需为有效的非负金额');
    const premium = Number((sale - remaining).toFixed(2));
    const days = Math.max(0, Math.ceil((due - trade) / 86400000));
    const percent = days / cycleDays * 100;
    const isReference = reference?.currency === currency && reference.rate === rate && Number.isFinite(dateValue(reference.date));
    const isCNY = currency === 'CNY' && rate === 1;
    const rateText = rate < 1e-8 ? rate.toExponential(4) : new Intl.NumberFormat('en-US', { maximumFractionDigits: 8, useGrouping: false }).format(rate);
    return {
        progress: Math.min(100, percent),
        premiumTone: premium < 0 ? 'discount' : premium > 0 ? 'premium' : 'neutral',
        values: {
            sale: formatMoney(sale),
            original: isCNY ? '人民币报价' : `≈ ${formatMoney(sale / rate)} ${currency}`,
            remaining: formatMoney(remaining),
            premiumLabel: premium < 0 ? '折价' : premium > 0 ? '溢价' : '无溢价',
            premium: `${premium < 0 ? '− ' : premium > 0 ? '+ ' : ''}¥${formatMoney(Math.abs(premium))}`,
            days: integer.format(days),
            percent: new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(percent),
            cycleDays: integer.format(cycleDays),
            periodDetail: days > cycleDays ? `超出本周期 ${integer.format(days - cycleDays)} 天` : `已使用 ${integer.format(cycleDays - days)} 天`,
            tradeDate: tradeDate.replaceAll('-', ' / '),
            dueDate: dueDate.replaceAll('-', ' / '),
            renewal: `${formatMoney(price)} ${currency} / ${cycleLabel}`,
            renewalCNYLabel: isCNY ? '人民币' : '人民币约',
            renewalCNY: `¥ ${formatMoney(price * rate)}`,
            cycleLabel: `/ ${cycleLabel}`,
            rateLabel: isReference ? '参考汇率' : isCNY ? '同币种换算' : '自定义汇率',
            rate: `1 ${currency} = ${rateText} CNY`,
            source: isReference ? 'Currency API' : isCNY ? '人民币计价' : '自定义汇率',
            sourceDetail: isReference ? `数据日期 ${reference.date}` : isCNY ? '按人民币直接计算' : '按当前填写汇率计算',
        },
    };
}

const template = `
<article class="share-image-card" aria-label="VPS 转让报价卡">
    <header class="share-topline"><div class="share-brand"><span class="share-brand-mark" aria-hidden="true">↗</span>VPS 工具箱</div><span class="share-offer-tag">VPS 转让</span></header>
    <section class="share-hero">
        <h2>交易报价</h2>
        <div class="share-hero-money"><span class="share-currency-sign">¥</span><span class="share-sale share-num" data-share="sale"></span></div>
        <div class="share-hero-subline"><span class="share-original share-num" data-share="original"></span><span class="share-unit">人民币 · CNY</span></div>
    </section>
    <div class="share-breakdown">
        <div><p class="share-label">剩余价值</p><p class="share-secondary-amount share-num">¥ <span data-share="remaining"></span></p></div>
        <div><p class="share-label" data-share="premiumLabel"></p><p class="share-secondary-amount share-adjustment share-num" data-share="premium"></p></div>
    </div>
    <section class="share-period">
        <div class="share-period-heading"><h2>剩余时间 <strong class="share-num" data-share="days"></strong><span>天</span></h2><span class="share-period-percent share-num"><span data-share="percent"></span><small>%</small></span></div>
        <div class="share-period-track" role="progressbar" aria-label="付款周期剩余比例" aria-valuemin="0" aria-valuemax="100"><span class="share-period-fill"></span></div>
        <div class="share-period-caption"><span>付款周期共 <strong class="share-num" data-share="cycleDays"></strong> 天</span><span class="share-num" data-share="periodDetail"></span></div>
        <div class="share-dates"><span>交易日期<strong class="share-num" data-share="tradeDate"></strong></span><span>到期日期<strong class="share-num" data-share="dueDate"></strong></span></div>
    </section>
    <section class="share-renewal">
        <h2>续费信息</h2>
        <div class="share-renewal-main"><strong class="share-renewal-price share-num" data-share="renewal"></strong><span><span class="share-num" data-share="cycleDays"></span> 天 / 周期</span></div>
        <p class="share-renewal-cny"><span data-share="renewalCNYLabel"></span><strong class="share-num" data-share="renewalCNY"></strong><small data-share="cycleLabel"></small></p>
        <p class="share-rate-line"><span data-share="rateLabel"></span><span class="share-num" data-share="rate"></span></p>
    </section>
    <footer class="share-footer"><strong data-share="source"></strong><span class="share-num" data-share="sourceDetail"></span></footer>
</article>`;

function fitText(card) {
    const targets = [
        ['.share-sale', 32], ['.share-original', 16], ['.share-secondary-amount', 17],
        ['.share-renewal-price', 17], ['.share-renewal-cny strong', 17], ['.share-rate-line', 14],
        ['.share-period-heading strong', 22], ['.share-period-percent', 17],
    ];
    for (const [selector, minimum] of targets) {
        card.querySelectorAll(selector).forEach(element => {
            let size = parseFloat(getComputedStyle(element).fontSize);
            while (element.scrollWidth > element.clientWidth + 1 && size > minimum) element.style.fontSize = `${--size}px`;
        });
    }
}

export async function renderShareCard(data) {
    const host = document.createElement('div');
    host.className = 'share-card-renderer';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    host.innerHTML = template;
    const card = host.firstElementChild;
    for (const element of card.querySelectorAll('[data-share]')) element.textContent = data.values[element.dataset.share];
    card.dataset.adjustment = data.premiumTone;
    const track = card.querySelector('.share-period-track');
    track.setAttribute('aria-valuenow', data.progress.toFixed(1));
    track.setAttribute('aria-valuetext', `剩余 ${data.values.days} 天，占付款周期 ${data.values.percent}%`);
    card.querySelector('.share-period-fill').style.width = `${data.progress}%`;
    document.body.appendChild(host);
    try {
        const [renderer] = await Promise.all([preloadShareCard(), document.fonts.ready]);
        fitText(card);
        const canvas = await renderer.toCanvas(card, { width: CARD_WIDTH, height: CARD_HEIGHT, pixelRatio: 2, skipFonts: true });
        return await new Promise((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), 'image/webp', 0.98);
        });
    } finally {
        host.remove();
    }
}
