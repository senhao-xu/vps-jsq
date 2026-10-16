import { enhanceCurrencySelect } from './currency-picker.js';
import { fetchReferenceRates, getCachedRates } from './rate-data.js';

const currencies = {
    USD: { name: '美元', english: 'US Dollar', symbol: '$', flag: '🇺🇸' },
    CNY: { name: '人民币', english: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
    EUR: { name: '欧元', english: 'Euro', symbol: '€', flag: '🇪🇺' },
    GBP: { name: '英镑', english: 'British Pound', symbol: '£', flag: '🇬🇧' },
    JPY: { name: '日元', english: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
    HKD: { name: '港元', english: 'Hong Kong Dollar', symbol: 'HK$', flag: '🇭🇰' },
    AUD: { name: '澳元', english: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
    CAD: { name: '加拿大元', english: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
    SGD: { name: '新加坡元', english: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' },
    KRW: { name: '韩元', english: 'South Korean Won', symbol: '₩', flag: '🇰🇷' },
    TWD: { name: '新台币', english: 'New Taiwan Dollar', symbol: 'NT$', flag: '🇹🇼' },
};

const popularCodes = ['USD', 'EUR', 'HKD', 'JPY'];
const referenceAmounts = [10, 50, 100, 500, 1000];
const byId = (id) => document.getElementById(id);
const els = {
    amount: byId('exchangeAmount'), from: byId('fromCurrency'), to: byId('toCurrency'),
    customEnabled: byId('customRateEnabled'), custom: byId('exchangeCustomRate'),
    result: byId('exchangeResult'), refresh: byId('refreshExchangeRates'), copy: byId('copyExchangeResult'),
};
const cached = getCachedRates();
let rates = cached?.rates || { CNY: 1 };
let dataSource = cached ? 'cached' : 'loading';
let rateTimestamp = cached?.updatedAt || 0;
let toastTimer;
let copiedTimer;
let lastFetchAttempt = 0;
let rateRequestPending = false;


for (const [code, currency] of Object.entries(currencies)) {
    for (const select of [els.from, els.to]) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = `${code} ${currency.name}`;
        select.append(option);
    }
}
els.from.value = 'USD';
els.to.value = 'CNY';

const currencyPickers = [els.from, els.to].map(enhanceCurrencySelect);

// Keep these controls in place while amounts change so keyboard focus is preserved.
const popularButtons = new Map(popularCodes.map((code) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'popular-pair';
    button.setAttribute('aria-label', `换算${currencies[code].name}至人民币`);
    button.innerHTML = `<span class="pair-heading"><span class="pair-flag" aria-hidden="true">${currencies[code].flag}</span>${code}<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>CNY<svg class="icon pair-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="pair-value"></span>`;
    button.addEventListener('click', () => {
        els.from.value = code;
        els.to.value = 'CNY';
        els.customEnabled.checked = false;
        render();
    });
    byId('popularCurrencies').append(button);
    return [code, button];
}));

function formatAmount(value) {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatRate(value) {
    if (!Number.isFinite(value)) return '—';
    if (value > 0 && value < 0.00000001) return value.toExponential(4);
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 4,
        maximumFractionDigits: value > 0 && value < 0.01 ? 8 : 4,
    }).format(value);
}

function marketRate() {
    if (els.from.value === els.to.value) return 1;
    return rates[els.to.value] / rates[els.from.value];
}

function currentRate() {
    if (!els.customEnabled.checked) return marketRate();
    const value = els.custom.valueAsNumber;
    return Number.isFinite(value) && value > 0 && Number.isFinite(1 / value) ? value : NaN;
}

function currentAmount() {
    const value = els.amount.valueAsNumber;
    return Number.isFinite(value) && value >= 0 && value <= 999999999999 ? value : NaN;
}

function updateSource() {
    const hasReference = dataSource === 'cached' || dataSource === 'reference';
    const sameCurrency = els.from.value === els.to.value;
    byId('sourceLabel').classList.toggle('fetched', hasReference);
    byId('sourceText').textContent = hasReference ? `参考汇率${dataSource === 'cached' ? ' · 已缓存' : ' · 已更新'}` : dataSource === 'loading' ? '正在获取汇率' : '参考汇率不可用';
    byId('rateMode').textContent = els.customEnabled.checked ? '自定义' : sameCurrency ? '同币种' : hasReference ? '参考' : dataSource === 'loading' ? '加载中' : '待更新';
    const note = byId('rateNote');
    if (!hasReference) {
        note.textContent = dataSource === 'loading'
            ? '正在获取参考汇率，也可填写自定义汇率。'
            : '参考汇率暂不可用，请稍后点击「更新汇率」重试，或填写自定义汇率。';
    } else {
        const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(rateTimestamp));
        note.replaceChildren('参考汇率由 ');
        const link = document.createElement('a');
        link.href = 'https://www.exchangerate-api.com';
        link.textContent = 'ExchangeRate-API';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        note.append(link, ` 提供 · 数据更新于 ${date}（北京时间）${els.customEnabled.checked ? ' · 当前换算使用自定义汇率' : ''}`);
    }
}

function render() {
    currencyPickers.forEach(picker => picker.sync());
    const from = els.from.value;
    const to = els.to.value;
    const rate = currentRate();
    const amount = currentAmount();
    const validAmount = Number.isFinite(amount);
    const validRate = Number.isFinite(rate);
    const result = amount * rate;
    const validResult = validAmount && validRate && Number.isFinite(result);

    byId('amountSymbol').textContent = currencies[from].symbol;
    byId('amountCode').textContent = from;
    byId('fromFlag').textContent = currencies[from].flag;
    byId('toFlag').textContent = currencies[to].flag;
    byId('resultCurrencyBadge').textContent = `${to} · ${currencies[to].name}`;
    byId('resultSymbol').textContent = currencies[to].symbol;
    byId('resultName').textContent = `${currencies[to].name} ${currencies[to].english}`;
    byId('resultOriginal').textContent = `${validAmount ? formatAmount(amount) : '—'} ${from} =`;
    els.result.textContent = validResult ? formatAmount(result) : '—';
    els.result.classList.toggle('medium', els.result.textContent.length > 9 && els.result.textContent.length <= 13);
    els.result.classList.toggle('long', els.result.textContent.length > 13);
    els.copy.disabled = !validResult;
    els.amount.setAttribute('aria-invalid', String(!validAmount));
    byId('amountField').classList.toggle('invalid', !validAmount);
    byId('amountError').hidden = validAmount;
    els.custom.setAttribute('aria-invalid', String(els.customEnabled.checked && !validRate));
    byId('customRateError').hidden = validRate || !els.customEnabled.checked;
    byId('customRatePanel').hidden = !els.customEnabled.checked;
    byId('customRateLabel').textContent = `1 ${from} =`;
    byId('customRateCode').textContent = to;
    byId('forwardRate').textContent = `1 ${from} = ${formatRate(rate)} ${to}`;
    byId('reverseRate').textContent = `1 ${to} = ${formatRate(1 / rate)} ${from}`;

    document.querySelectorAll('[data-amount]').forEach((button) => {
        const selected = Number(button.dataset.amount) === amount;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });

    for (const [code, button] of popularButtons) {
        const active = from === code && to === 'CNY';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
        button.querySelector('.pair-check').toggleAttribute('hidden', !active);
        button.querySelector('.pair-value').innerHTML = `${formatRate(rates.CNY / rates[code])}<small>CNY</small>`;
    }

    byId('referencePair').textContent = `${from} / ${to}${els.customEnabled.checked ? ' · 自定义汇率' : ''}`;
    byId('referenceAmounts').innerHTML = `<th scope="col">${from} ${currencies[from].name}</th>${referenceAmounts.map((value) => `<th scope="col">${value.toLocaleString('en-US')}</th>`).join('')}`;
    byId('referenceResults').innerHTML = `<th scope="row">${to} ${currencies[to].name}</th>${referenceAmounts.map((value) => `<td>${validRate && Number.isFinite(value * rate) ? formatAmount(value * rate) : '—'}</td>`).join('')}`;
    updateSource();
}

function resetCustomRate() {
    // A custom rate belongs to a specific pair, so a new pair starts at its reference rate.
    const rate = marketRate();
    els.custom.value = Number.isFinite(rate) ? Number(rate.toPrecision(10)).toString() : '';
    render();
}

function showToast(message) {
    const toast = byId('exchangeToast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

els.amount.addEventListener('input', render);
els.custom.addEventListener('input', render);
els.from.addEventListener('change', resetCustomRate);
els.to.addEventListener('change', resetCustomRate);
els.customEnabled.addEventListener('change', () => {
    if (els.customEnabled.checked) resetCustomRate();
    else render();
    if (els.customEnabled.checked) els.custom.focus();
});
document.querySelectorAll('[data-amount]').forEach((button) => {
    button.addEventListener('click', () => {
        els.amount.value = button.dataset.amount;
        render();
    });
});
byId('swapCurrencies').addEventListener('click', () => {
    const rate = currentRate();
    [els.from.value, els.to.value] = [els.to.value, els.from.value];
    if (els.customEnabled.checked && Number.isFinite(rate)) els.custom.value = Number((1 / rate).toPrecision(10)).toString();
    render();
});

els.copy.addEventListener('click', async () => {
    const amount = currentAmount();
    const rate = currentRate();
    if (!Number.isFinite(amount * rate)) return;
    const source = els.customEnabled.checked ? '自定义汇率' : els.from.value === els.to.value ? '同币种' : '参考汇率';
    const text = `${formatAmount(amount)} ${els.from.value} = ${formatAmount(amount * rate)} ${els.to.value}\n1 ${els.from.value} = ${formatRate(rate)} ${els.to.value}（${source}）`;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.append(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            textarea.remove();
            if (!copied) throw new Error('Clipboard unavailable');
        }
        els.copy.querySelector('span').textContent = '已复制';
        els.copy.querySelector('use').setAttribute('href', '#i-check');
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
            els.copy.querySelector('span').textContent = '复制换算结果';
            els.copy.querySelector('use').setAttribute('href', '#i-copy');
        }, 2000);
        showToast('换算结果已复制');
    } catch { showToast('复制失败，请选择换算结果手动复制'); }
});

async function refreshRates({ manual = false } = {}) {
    if (rateRequestPending) return;
    if (Date.now() - lastFetchAttempt < 60000) {
        if (manual) showToast('刚刚已尝试更新，请稍后再试');
        return;
    }
    lastFetchAttempt = Date.now();
    rateRequestPending = true;
    els.refresh.disabled = true;
    els.refresh.classList.add('loading');
    els.refresh.querySelector('span').textContent = '更新中';
    try {
        const data = await fetchReferenceRates({ force: manual });
        rates = data.rates;
        dataSource = 'reference';
        rateTimestamp = data.updatedAt;
        render();
        if (manual) showToast(els.customEnabled.checked ? '参考汇率已更新，当前仍使用自定义汇率' : '参考汇率已更新');
    } catch {
        if (dataSource === 'loading') dataSource = 'unavailable';
        render();
        showToast(dataSource === 'unavailable' ? '获取汇率失败，可填写自定义汇率或稍后重试' : '更新失败，已保留上次参考汇率');
    } finally {
        rateRequestPending = false;
        els.refresh.disabled = false;
        els.refresh.classList.remove('loading');
        els.refresh.querySelector('span').textContent = '更新汇率';
    }
}

els.refresh.addEventListener('click', () => refreshRates({ manual: true }));

window.addEventListener('toolbox:change', () => {
    const latest = getCachedRates();
    if (latest && latest.rates !== rates) {
        rates = latest.rates;
        rateTimestamp = latest.updatedAt;
        dataSource = 'reference';
        render();
    }
});

render();
if (dataSource === 'loading') refreshRates();
