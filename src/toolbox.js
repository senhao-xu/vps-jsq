import './main.js';
import './exchange.js';

const views = { value: document.getElementById('valueTool'), exchange: document.getElementById('exchangeTool') };
const titles = { value: '剩余价值', exchange: '汇率换算' };

function activateTool({ focus = false } = {}) {
    const tool = location.pathname.endsWith('/exchange.html') ? 'exchange' : 'value';
    document.documentElement.dataset.tool = tool;
    for (const [name, view] of Object.entries(views)) view.hidden = name !== tool;
    document.querySelectorAll('.tool-nav a[data-tool]').forEach(link => {
        const active = link.dataset.tool === tool;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    document.title = `${titles[tool]} · VPS 工具箱`;
    window.dispatchEvent(new CustomEvent('toolbox:change', { detail: { tool } }));
    if (focus) {
        const heading = views[tool].querySelector('h1');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }
}

document.addEventListener('click', event => {
    const link = event.target.closest('a[data-tool]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    event.preventDefault();
    const url = new URL(link.href);
    if (url.pathname === location.pathname) return;
    history.pushState(null, '', url.pathname);
    activateTool({ focus: true });
});
window.addEventListener('popstate', () => activateTool({ focus: true }));
activateTool();
