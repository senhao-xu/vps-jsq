const cacheKey = 'vps_exchange_rates_v1';
const cacheDuration = 12 * 60 * 60 * 1000;
const codes = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD', 'KRW', 'TWD'];
let cachedRates;
let pendingRequest;

function validRates(value) {
    return value && value.CNY === 1 && codes.every(code => Number.isFinite(value[code]) && value[code] > 0);
}

export function getCachedRates() {
    try {
        const data = cachedRates || JSON.parse(localStorage.getItem(cacheKey));
        if (data && validRates(data.rates) && Number.isFinite(data.updatedAt) && data.updatedAt > 0
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
            const response = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: controller.signal });
            if (!response.ok) throw new Error('Rate request failed');
            const data = await response.json();
            if (data.result !== 'success' || data.base_code !== 'CNY' || !validRates(data.rates)
                || !Number.isFinite(data.time_last_update_unix) || data.time_last_update_unix <= 0) throw new Error('Invalid rate response');
            cachedRates = { rates: data.rates, updatedAt: data.time_last_update_unix * 1000, savedAt: Date.now() };
            try { localStorage.setItem(cacheKey, JSON.stringify(cachedRates)); } catch {}
            return cachedRates;
        } finally {
            clearTimeout(timeout);
            pendingRequest = undefined;
        }
    })();
    return pendingRequest;
}
