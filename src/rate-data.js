const cacheKey = 'vps_currency_api_rates_v1';
const cacheDuration = 12 * 60 * 60 * 1000;
const codes = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD', 'KRW', 'TWD'];
let cachedRates;
let pendingRequest;

function validRates(value) {
    return value && value.CNY === 1 && codes.every(code => Number.isFinite(value[code]) && value[code] > 0);
}

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function getCachedRates() {
    try {
        const data = cachedRates || JSON.parse(localStorage.getItem(cacheKey));
        if (data && validRates(data.rates) && validDate(data.date)
            && Number.isFinite(data.savedAt) && Date.now() >= data.savedAt && Date.now() - data.savedAt < cacheDuration) {
            cachedRates = data;
            return data;
        }
    } catch { /* Storage is optional; both tools can use an in-memory response. */ }
    return null;
}

// Share both cached data and in-flight requests between the two tools.
export function fetchReferenceRates({ force = false } = {}) {
    if (!force) {
        const cached = getCachedRates();
        if (cached) return Promise.resolve(cached);
    }
    if (pendingRequest) return pendingRequest;
    pendingRequest = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch('https://latest.currency-api.pages.dev/v1/currencies/cny.json', { signal: controller.signal });
            if (!response.ok) throw new Error('Rate request failed');
            const data = await response.json();
            // Currency API uses lowercase codes and quotes each currency per 1 CNY.
            const rates = Object.fromEntries(codes.map(code => [code, data?.cny?.[code.toLowerCase()]]));
            if (!validRates(rates) || !validDate(data?.date)) throw new Error('Invalid rate response');
            cachedRates = { rates, date: data.date, savedAt: Date.now() };
            try { localStorage.setItem(cacheKey, JSON.stringify(cachedRates)); } catch {}
            return cachedRates;
        } finally {
            clearTimeout(timeout);
            pendingRequest = undefined;
        }
    })();
    return pendingRequest;
}
