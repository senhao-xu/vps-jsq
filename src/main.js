import { enhanceCurrencySelect } from './currency-picker.js';
import { fetchReferenceRates } from './rate-data.js';
import { createShareData, preloadShareCard, renderShareCard } from './share-card.js';

// 样式表已改为 index.html 中 <link rel="stylesheet"> 渲染阻塞式加载（见 head 注释），
// 不再通过 JS 模块注入，避免 CSS 就绪前内容以默认样式绘制造成闪变。

// 手动刷新次数的统计窗口（小时）；参考汇率每日更新。
const REFRESH_LIMIT_HOURS = 12;
// 限制重复的手动请求。
const MANUAL_REFRESH_LIMIT = 2;
let generatedImageUrl = '';

const currencySymbols = {
    'USD': '$', 'EUR': '\u20AC', 'GBP': '\u00A3', 'JPY': '\u00A5',
    'CNY': '\u00A5', 'HKD': 'HK$', 'AUD': 'A$', 'SGD': 'S$',
    'KRW': '\u20A9', 'TWD': 'NT$', 'CAD': 'C$'
};

const els = {
    price: document.getElementById('price'),
    currency: document.getElementById('currency'),
    cycles: document.getElementsByName('cycle'),
    dueDate: document.getElementById('dueDate'),
    tradeDate: document.getElementById('tradeDate'),
    customRate: document.getElementById('customRate'),
    apiRateDisplay: document.getElementById('apiRateDisplay'),
    refreshBtn: document.getElementById('refreshRateBtn'),
    refreshIcon: document.getElementById('refreshIcon'),
    symbolDisplay: document.querySelector('.symbol-display'),
    finalValue: document.getElementById('finalValue'),
    totalValue: document.getElementById('totalValue'),
    originalCurrencyValue: document.getElementById('originalCurrencyValue'),
    amountCopyTip: document.getElementById('amountCopyTip'),
    premiumInput: document.getElementById('premiumInput'),
    salePriceInput: document.getElementById('salePriceInput'),
    daysRemaining: document.getElementById('daysRemaining'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    priceCNYPreview: document.getElementById('priceCNYPreview'),
    toast: document.getElementById('toast'),
    rateLimitTip: document.getElementById('rateLimitTip'),
    themeToggle: document.getElementById('themeToggle'),
    rateCurrencyLabel: document.getElementById('rateCurrencyLabel')
};

const currencyPicker = enhanceCurrencySelect(els.currency);

let rateLimitTimer = null;
let remainingValueCNY = 0;
let quoteLastEdited = 'premium';
let currentRateReference = null;
let imageRequestId = 0;
let imageGenerating = false;
let imageModalCloseTimer;

function initCalculator() {
    initTheme();
    loadInputsFromCookie();
    initQuoteFields();
    initDates();
    syncDateDisplay(els.dueDate);
    syncDateDisplay(els.tradeDate);
    initRates();
    setupEventListeners();
    calculate();
}

window.addEventListener('toolbox:change', updateCurrencySymbol);

function setupEventListeners() {
    const debouncedSave = debounce(saveInputsToCookie, 500);

    [els.price, els.dueDate, els.tradeDate, els.customRate].forEach(el => el.addEventListener('input', () => {
        if (el.type === 'date') syncDateDisplay(el);
        calculate();
        debouncedSave();
    }));

    [els.dueDate, els.tradeDate].forEach(el => el.addEventListener('change', () => {
        syncDateDisplay(el);
        calculate();
        saveInputsToCookie();
    }));
    
    els.cycles.forEach(radio => radio.addEventListener('change', () => {
        calculate();
        saveInputsToCookie();
    }));

    els.currency.addEventListener('change', () => {
        updateCurrencySymbol();
        initRates(); 
        calculate();
        saveInputsToCookie();
    });

    els.refreshBtn.addEventListener('click', manualRefreshRate); 
    els.themeToggle.addEventListener('click', toggleTheme);
    els.finalValue.addEventListener('click', copyFinalValueAmount);
    els.finalValue.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        copyFinalValueAmount();
    });

    [els.premiumInput, els.salePriceInput].forEach(el => {
        el.addEventListener('input', () => {
            quoteLastEdited = el === els.salePriceInput ? 'sale' : 'premium';
            syncQuoteFields();
            debouncedSave();
        });

        el.addEventListener('blur', () => {
            syncQuoteFields({ formatActive: true });
            saveInputsToCookie();
        });
    });

    // Keep the text area editable; only the calendar button opens the picker.
    document.querySelectorAll('.date-input-wrapper .date-input-icon').forEach((button) => {
        button.addEventListener('click', () => {
            const input = button.parentElement.querySelector('input[type="date"]');
            input.focus();
            try {
                input.showPicker?.();
            } catch { /* Keep keyboard editing available when the picker is unsupported. */ }
        });
    });

    // 价格 / 汇率 输入校验：负数或非法时高亮红边
    [els.price, els.customRate].forEach(el => {
        el.addEventListener('input', () => validateNumberInput(el));
        validateNumberInput(el);
    });

    els.salePriceInput.addEventListener('input', () => validateNumberInput(els.salePriceInput));
    validateNumberInput(els.salePriceInput);

    // ESC 关闭模态 / 限流提示
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!modal.el.classList.contains('hidden')) closeImageModal();
        if (els.rateLimitTip.classList.contains('show')) hideRateLimitTip();
    });
}

function validateNumberInput(el) {
    const raw = el.value.trim();
    if (raw === '') {
        el.classList.remove('input-invalid');
        return true;
    }
    const v = parseFloat(raw);
    const ok = Number.isFinite(v) && v >= 0;
    el.classList.toggle('input-invalid', !ok);
    return ok;
}

function initQuoteFields() {
    updateQuotePlaceholders();
    syncQuoteFields();
}

function parseQuoteValue(value) {
    if (typeof value !== 'string' || value.trim() === '') return NaN;
    return parseFloat(value);
}

function formatMoney(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '';
}

function updatePremiumTone(value) {
    els.premiumInput.classList.remove('premium-positive', 'premium-negative', 'premium-neutral');

    if (!Number.isFinite(value) || value === 0) {
        els.premiumInput.classList.add('premium-neutral');
    } else if (value > 0) {
        els.premiumInput.classList.add('premium-positive');
    } else {
        els.premiumInput.classList.add('premium-negative');
    }
}

function updateSaleTone(isNeutral) {
    els.salePriceInput.classList.toggle('sale-neutral', isNeutral);
}

function updateQuotePlaceholders() {
    els.premiumInput.placeholder = '0.00';
    els.salePriceInput.placeholder = formatMoney(remainingValueCNY) || '0.00';
}

function syncQuoteFields(options = {}) {
    const { formatActive = false } = options;
    const premiumRaw = els.premiumInput.value.trim();
    const saleRaw = els.salePriceInput.value.trim();

    updateQuotePlaceholders();

    if (quoteLastEdited === 'sale') {
        const salePrice = parseQuoteValue(saleRaw);

        if (Number.isFinite(salePrice)) {
            const premium = salePrice - remainingValueCNY;
            els.premiumInput.value = formatMoney(premium);
            if (formatActive) els.salePriceInput.value = formatMoney(salePrice);
            updatePremiumTone(premium);
            updateSaleTone(false);
        } else {
            els.premiumInput.value = '';
            updatePremiumTone(NaN);
            updateSaleTone(true);
        }
        return;
    }

    const premium = premiumRaw === '' ? 0 : parseQuoteValue(els.premiumInput.value);

    if (Number.isFinite(premium)) {
        if (premiumRaw === '') {
            els.salePriceInput.value = '';
            updatePremiumTone(0);
            updateSaleTone(true);
            return;
        }

        const salePrice = remainingValueCNY + premium;
        els.salePriceInput.value = formatMoney(salePrice);
        if (formatActive) els.premiumInput.value = formatMoney(premium);
        updatePremiumTone(premium);
        updateSaleTone(premiumRaw === '' || premium === 0);
    } else {
        els.salePriceInput.value = '';
        updatePremiumTone(NaN);
        updateSaleTone(true);
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function initTheme() {
    let savedTheme;
    try { savedTheme = localStorage.getItem('theme'); } catch {}
    const isDark = savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    updateToggleUI(isDark);
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch {}
    updateToggleUI(isDark);
}

function updateToggleUI(isDark) {
    els.themeToggle.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
}

// 注意：函数名沿用历史命名（setCookie / getCookie），实际底层是 localStorage + 过期时间，
// 同时兼容旧版本可能写到 document.cookie 的数据。
function setCookie(name, value, hours) {
    const expiresAt = Date.now() + (hours * 60 * 60 * 1000);
    localStorage.setItem(name, JSON.stringify({ value, expiresAt }));
}

function getCookie(name) {
    const stored = localStorage.getItem(name);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (!parsed.expiresAt || parsed.expiresAt > Date.now()) {
                return parsed.value || "";
            }
            localStorage.removeItem(name);
        } catch (e) {
            localStorage.removeItem(name);
        }
    }

    const cname = name + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for(let i = 0; i <ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(cname) == 0) {
            return c.substring(cname.length, c.length);
        }
    }
    return "";
}

function resetGeneratedImage() {
    if (generatedImageUrl) {
        URL.revokeObjectURL(generatedImageUrl);
    }
    generatedImageUrl = '';
}

function formatDateForDisplay(value) {
    return value ? value.replace(/-/g, '/') : '--/--/--';
}

function syncDateDisplay(input) {
    const wrapper = input && input.parentElement;
    const display = wrapper && wrapper.querySelector('.date-display-value');
    if (!display) return;
    display.textContent = formatDateForDisplay(input.value);
}

function saveInputsToCookie() {
    const data = {
        price: els.price.value,
        currency: els.currency.value,
        cycle: Array.from(els.cycles).find(r => r.checked)?.value || "365",
        dueDate: els.dueDate.value,
        customRate: els.customRate.value,
        referenceProvider: 'currency-api',
        premium: els.premiumInput.value,
        salePrice: els.salePriceInput.value,
        quoteLastEdited
    };
    setCookie("vps_inputs", JSON.stringify(data), 0.5);
}

function loadInputsFromCookie() {
    const saved = getCookie("vps_inputs");
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if(data.price) els.price.value = data.price;
            if(data.currency) els.currency.value = data.currency;
            if(data.dueDate) els.dueDate.value = data.dueDate;
            // Ignore saved automatic rates from the previous provider.
            if (data.referenceProvider === 'currency-api' && data.customRate) els.customRate.value = data.customRate;
            if(data.quoteLastEdited === 'sale' || data.quoteLastEdited === 'premium') {
                quoteLastEdited = data.quoteLastEdited;
                if (quoteLastEdited === 'sale' && data.salePrice) {
                    els.salePriceInput.value = data.salePrice;
                } else if (quoteLastEdited === 'premium' && data.premium && parseFloat(data.premium) !== 0) {
                    els.premiumInput.value = data.premium;
                }
            }
            if(data.cycle) {
                const radio = document.querySelector(`input[name="cycle"][value="${data.cycle}"]`);
                if(radio) radio.checked = true;
            }
            updateCurrencySymbol();
        } catch(e) { console.error("Cookie parse error", e); }
    }
}

async function initRates() {
    const base = els.currency.value;
    if (base === 'CNY') {
        finishRateUpdate(1, "1.0000");
        return;
    }

    await manualRefreshRate(false);
}

async function manualRefreshRate(isUserClick = true) {
    const base = els.currency.value;
    if (base === 'CNY') return;

    const limitKey = "vps_refresh_limit";
    const rawLimit = getCookie(limitKey);
    let limitData = { count: 0, resetTime: Date.now() + REFRESH_LIMIT_HOURS*3600*1000 };

    if (rawLimit) {
        try {
            const parsed = JSON.parse(rawLimit);
            if (parsed.resetTime && Date.now() < parsed.resetTime) {
                limitData = parsed;
            } else {
                limitData = { count: 0, resetTime: Date.now() + REFRESH_LIMIT_HOURS*3600*1000 };
            }
        } catch(e) {}
    }

    if (isUserClick) {
        if (limitData.count >= MANUAL_REFRESH_LIMIT) {
            showRateLimitTip();
            return;
        }
        limitData.count++;
        const hoursLeft = (limitData.resetTime - Date.now()) / (1000*3600);
        setCookie(limitKey, JSON.stringify(limitData), Math.max(0.1, hoursLeft));
    }

    await fetchExchangeRate(Boolean(isUserClick));
}

async function fetchExchangeRate(force = false) {
    const base = els.currency.value;
    els.refreshIcon.classList.add('spin');
    els.apiRateDisplay.textContent = "刷新中";

    try {
        const data = await fetchReferenceRates({ force });
        if (base !== els.currency.value) return;
        const rate = 1 / data.rates[base];
        currentRateReference = { currency: base, rate: Number(rate.toFixed(4)), date: data.date };
        finishRateUpdate(rate, rate.toFixed(4));
        saveInputsToCookie();
    } catch (error) {
        console.error(error);
        els.apiRateDisplay.textContent = "汇率刷新";
        els.refreshIcon.classList.remove('spin');
        showToast("获取汇率失败");
    }
}

function finishRateUpdate(rate, text) {
    els.customRate.value = rate.toFixed(4);
    els.apiRateDisplay.textContent = "汇率刷新";
    els.refreshIcon.classList.remove('spin');
    calculate();
}

function showRateLimitTip() {
    els.rateLimitTip.classList.add('show');
    if (rateLimitTimer) clearTimeout(rateLimitTimer);
    rateLimitTimer = setTimeout(() => {
        hideRateLimitTip();
    }, 2000);
}

function hideRateLimitTip() {
    els.rateLimitTip.classList.remove('show');
    if (rateLimitTimer) {
        clearTimeout(rateLimitTimer);
        rateLimitTimer = null;
    }
}

function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => {
        els.toast.classList.remove('show');
    }, 2000);
}

function getBlackFriday(year) {
    const novemberFirst = new Date(year, 10, 1);
    const firstThursday = 1 + ((4 - novemberFirst.getDay() + 7) % 7);
    const thanksgivingDay = firstThursday + 21;
    return new Date(year, 10, thanksgivingDay + 1);
}

function getNextBlackFriday(date) {
    const currentYearBlackFriday = getBlackFriday(date.getFullYear());
    return date.getTime() < currentYearBlackFriday.getTime()
        ? currentYearBlackFriday
        : getBlackFriday(date.getFullYear() + 1);
}

function initDates() {
    const now = new Date();
    els.tradeDate.value = formatDate(now);
    syncDateDisplay(els.tradeDate);
    if (els.dueDate.value) {
        syncDateDisplay(els.dueDate);
        return;
    }
    const targetDueDate = getNextBlackFriday(now);
    els.dueDate.value = formatDate(targetDueDate);
    syncDateDisplay(els.dueDate);
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function updateCurrencySymbol() {
    currencyPicker.sync();
    const code = els.currency.value;
    const sym = currencySymbols[code] || code;
    els.symbolDisplay.textContent = sym;
    if (els.rateCurrencyLabel) els.rateCurrencyLabel.textContent = `1 ${code} =`;
    // Dynamically adjust input left padding to prevent symbol/text overlap
    requestAnimationFrame(() => {
        const symRect = els.symbolDisplay.getBoundingClientRect();
        const inputRect = els.price.getBoundingClientRect();
        const neededPad = symRect.right - inputRect.left + 6;
        els.price.style.paddingLeft = Math.max(neededPad, 32) + 'px';
    });
}

function calculate() {
    const priceRaw = parseFloat(els.price.value);
    const rateRaw = parseFloat(els.customRate.value);
    const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
    const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 0;
    const due = new Date(els.dueDate.value);
    const trade = new Date(els.tradeDate.value);

    let cycleDays = 365;
    for (const radio of els.cycles) {
        if (radio.checked) { cycleDays = parseInt(radio.value); break; }
    }

    const totalCNY = price * rate;
    els.priceCNYPreview.textContent = `≈${totalCNY.toFixed(2)}元`;
    // 总价值 = 整个付款周期的价值（续费价格 × 汇率），与日期无关，
    // 因此放在日期校验的提前返回之前，任何输入状态下都保持更新。
    els.totalValue.textContent = `¥ ${totalCNY.toFixed(2)}`;

    // 空 / 非法日期：清空结果区，给出占位提示
    if (isNaN(due.getTime()) || isNaN(trade.getTime())) {
        remainingValueCNY = 0;
        setFinalValueDisplay('0.00');
        els.originalCurrencyValue.textContent = '请填写到期日 / 交易日';
        els.daysRemaining.textContent = '--';
        els.progressBar.style.width = '0%';
        els.progressText.textContent = '--';
        syncQuoteFields();
        return;
    }

    const diffTime = due - trade;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const dailyPrice = cycleDays > 0 ? price / cycleDays : 0;

    let valOrig = 0, valCNY = 0;

    if (diffDays > 0) {
        valOrig = dailyPrice * diffDays;
        valCNY = valOrig * rate;
    }

    // 进度条语义：当前续费周期内的「剩余比例」，文案显示按总剩余天数 / 周期取整。
    let progressPct;
    let displayProgressPct;
    if (diffDays <= 0) {
        progressPct = 0;
        displayProgressPct = 0;
    } else if (diffDays >= cycleDays) {
        progressPct = 100;
        displayProgressPct = Math.round((diffDays / cycleDays) * 100);
    } else {
        displayProgressPct = Math.max(1, Math.round((diffDays / cycleDays) * 100));
        progressPct = displayProgressPct;
    }

    els.progressBar.style.width = `${progressPct}%`;
    remainingValueCNY = valCNY;
    setFinalValueDisplay(valCNY.toFixed(2));
    els.originalCurrencyValue.textContent = `≈ ${valOrig.toFixed(2)} ${els.currency.value}`;
    els.daysRemaining.textContent = diffDays > 0 ? diffDays : '0';
    els.progressText.textContent = `${displayProgressPct}%`;
    syncQuoteFields();
}

function setFinalValueDisplay(value) {
    els.finalValue.textContent = value;
    const numericLength = value.replace(/[^0-9]/g, '').length;
    const isLongValue = numericLength >= 7;
    els.finalValue.classList.toggle('final-value-long', isLongValue);
    els.finalValue.classList.toggle('final-value-very-long', numericLength > 10);
    els.finalValue.closest('.result-amount-row')?.classList.toggle('final-value-row-long', isLongValue);
}

function copyResult() {
    const price = els.price.value || "0";
    const currency = els.currency.value;
    const rate = els.customRate.value || "0";
    const days = els.daysRemaining.textContent;
    const valCNY = els.finalValue.textContent;
    const valOrig = els.originalCurrencyValue.textContent.replace('≈', '').trim().split(' ')[0];
    const premium = els.premiumInput.value || '0.00';
    const salePrice = els.salePriceInput.value || valCNY;
    const tradeDate = els.tradeDate.value;
    const dueDate = els.dueDate.value;
    
    let cycleText = "年付";
    for (const radio of els.cycles) {
        if (radio.checked) { 
            cycleText = radio.parentElement.innerText.trim();
            break; 
        }
    }

    const cnyPrice = (parseFloat(price) * parseFloat(rate)).toFixed(2);
    const md = `## 🐔 VPS 剩余价值
- 📅 交易日期：${tradeDate}
- 💹 外币汇率：1 ${currency} ≈ ${rate} CNY
- 💰 续费价格：${price} ${currency}/${cycleText}（约 ${cnyPrice} 元）
- ⏳ 剩余天数：${days}天（${dueDate} 到期）
- 💎 剩余价值：${valCNY}元（约 ${valOrig} ${currency}）
- 🧾 溢价 / 总价：${premium}元 / ${salePrice}元`;

    copyTextToClipboard(md, flashCopyButton);
}

function copyTextToClipboard(text, done) {
    const fallbackCopy = () => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try { document.execCommand("copy"); } catch (_) {}
        document.body.removeChild(textArea);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(() => { fallbackCopy(); done(); });
    } else {
        fallbackCopy();
        done();
    }
}

function copyFinalValueAmount() {
    const amount = els.finalValue.textContent.trim();
    if (!amount) return;
    copyTextToClipboard(amount, flashAmountCopyTip);
}

function flashAmountCopyTip() {
    if (!els.amountCopyTip) return;
    els.amountCopyTip.classList.add('show');
    clearTimeout(flashAmountCopyTip._t);
    flashAmountCopyTip._t = setTimeout(() => {
        els.amountCopyTip.classList.remove('show');
    }, 1500);
}

function flashCopyButton() {
    const btn = document.getElementById('copyBtn');
    if (!btn) return;
    const label = btn.querySelector('span');
    const originalText = label ? label.textContent : '';
    btn.classList.add('btn-copied');
    if (label) label.textContent = '已复制 ✓';
    clearTimeout(flashCopyButton._t);
    flashCopyButton._t = setTimeout(() => {
        btn.classList.remove('btn-copied');
        if (label) label.textContent = originalText;
    }, 1500);
}

const modal = {
    el: document.getElementById('imageModal'),
    img: document.getElementById('generatedImage'),
    loading: document.getElementById('modalLoading'),
    actions: document.getElementById('modalActions')
};

function closeImageModal() {
    imageRequestId++;
    clearTimeout(imageModalCloseTimer);
    modal.el.classList.remove('opacity-100');
    imageModalCloseTimer = setTimeout(() => {
        modal.el.classList.add('hidden');
        modal.img.classList.add('hidden');
        modal.actions.classList.add('hidden');
        modal.loading.classList.remove('hidden');
        modal.img.src = '';
        resetGeneratedImage();
    }, 300);
}

// Close modal on background click
modal.el.addEventListener('click', (e) => {
    if (e.target === modal.el) closeImageModal();
});

function getShareImageData() {
    calculate();
    const cycle = Array.from(els.cycles).find(radio => radio.checked);
    const cycleText = cycle.parentElement.querySelector('.cycle-option').textContent.trim();
    const sale = parseQuoteValue(els.salePriceInput.value);
    return createShareData({
        price: els.price.value.trim() === '' ? 0 : els.price.valueAsNumber,
        currency: els.currency.value,
        rate: els.customRate.valueAsNumber,
        cycleDays: Number(cycle.value),
        cycleLabel: cycleText.replace(/付$/, ''),
        tradeDate: els.tradeDate.value,
        dueDate: els.dueDate.value,
        remainingValue: remainingValueCNY,
        salePrice: Number.isFinite(sale) ? sale : undefined,
        reference: currentRateReference,
    });
}

async function generateImage() {
    if (imageGenerating) return;
    let data;
    try {
        data = getShareImageData();
    } catch (error) {
        showToast(error.message);
        return;
    }
    imageGenerating = true;
    const requestId = ++imageRequestId;
    const button = document.getElementById('imgBtn');
    button.disabled = true;
    clearTimeout(imageModalCloseTimer);
    modal.img.classList.add('hidden');
    modal.actions.classList.add('hidden');
    modal.loading.classList.remove('hidden');
    modal.el.classList.remove('hidden');
    void modal.el.offsetWidth;
    modal.el.classList.add('opacity-100');
    try {
        const blob = await renderShareCard(data);
        if (requestId !== imageRequestId) return;
        resetGeneratedImage();
        generatedImageUrl = URL.createObjectURL(blob);
        modal.img.src = generatedImageUrl;
        await modal.img.decode();
        if (requestId !== imageRequestId) return;
        modal.loading.classList.add('hidden');
        modal.img.classList.remove('hidden');
        modal.actions.classList.remove('hidden');
    } catch (error) {
        if (requestId === imageRequestId) {
            console.error('Share image generation failed:', error);
            closeImageModal();
            showToast('生成图片失败，请稍后重试');
        }
    } finally {
        imageGenerating = false;
        button.disabled = false;
    }
}

// 用 addEventListener 绑定（替代 inline onclick），保持 HTML 与逻辑解耦
function bindActionButtons() {
    const map = [
        ['copyBtn', copyResult],
        ['imgBtn', generateImage],
        ['closeImageModalBtn', closeImageModal],
    ];
    for (const [id, fn] of map) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    // 鼠标悬停 / 键盘聚焦时预热 html-to-image，点击瞬间减少等待。仅触发一次。
    const imgBtn = document.getElementById('imgBtn');
    if (imgBtn) {
        const prefetch = () => {
            imgBtn.removeEventListener('pointerenter', prefetch);
            imgBtn.removeEventListener('focus', prefetch);
            preloadShareCard().catch(() => {});
        };
        imgBtn.addEventListener('pointerenter', prefetch, { once: true });
        imgBtn.addEventListener('focus', prefetch, { once: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindActionButtons);
} else {
    bindActionButtons();
}

// 底栏展示构建版本（git 短 sha，由 vite define 注入）
(() => {
    const el = document.getElementById('buildSha');
    if (el) el.textContent = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'dev';
})();

initCalculator();

