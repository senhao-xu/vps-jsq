let closeOpenPicker;

// Keep the original select as the form value and as a fallback before enhancement.
export function enhanceCurrencySelect(select) {
    const wrapper = select.parentElement;
    const label = select.getAttribute('aria-label')
        || Array.from(select.labels?.[0]?.childNodes || []).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
        || '币种';
    const choices = Array.from(select.options).map(option => ({
        value: option.value,
        code: option.value,
        name: option.textContent.trim().replace(new RegExp(`^${option.value}\\s*`), ''),
        disabled: option.disabled,
    }));
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `${select.className} currency-picker-trigger`;
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${select.id}-options`);
    const code = document.createElement('span');
    code.className = 'currency-picker-code';
    const name = document.createElement('span');
    name.className = 'currency-picker-name';
    trigger.append(code, name);

    // Place the menu outside clipped calculator cards, without changing their layout.
    const menu = document.createElement('div');
    menu.className = 'currency-picker-menu';
    menu.hidden = true;
    const heading = document.createElement('div');
    heading.className = 'currency-picker-heading';
    heading.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.textContent = '选择币种';
    const count = document.createElement('span');
    count.textContent = `${choices.length} 种货币`;
    heading.append(title, count);
    const list = document.createElement('div');
    list.id = `${select.id}-options`;
    list.className = 'currency-picker-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', label);
    const rows = choices.map((choice, index) => {
        const row = document.createElement('div');
        row.id = `${select.id}-option-${choice.value}`;
        row.className = 'currency-picker-option';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        if (choice.disabled) row.setAttribute('aria-disabled', 'true');
        const badge = document.createElement('span');
        badge.className = 'currency-picker-badge';
        badge.textContent = choice.code;
        const text = document.createElement('span');
        text.className = 'currency-picker-option-name';
        text.textContent = choice.name;
        const check = document.createElement('span');
        check.className = 'currency-picker-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        row.append(badge, text, check);
        row.addEventListener('pointermove', () => setActive(index, false));
        row.addEventListener('click', () => choose(index));
        list.append(row);
        return row;
    });
    menu.append(heading, list);
    document.body.append(menu);
    wrapper.append(trigger);
    wrapper.classList.add('currency-picker');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    let activeIndex = -1;
    let search = '';
    let searchTimer;

    function sync() {
        const selectedIndex = choices.findIndex(choice => choice.value === select.value);
        const selected = choices[selectedIndex];
        code.textContent = selected?.code || '';
        name.textContent = selected?.name || '';
        trigger.disabled = select.disabled;
        rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === selectedIndex)));
        if (!menu.hidden) setActive(selectedIndex);
    }

    function position() {
        const rect = trigger.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const viewportWidth = window.visualViewport?.width || window.innerWidth;
        const width = Math.min(Math.max(rect.width, 236), viewportWidth - 24);
        const below = viewportHeight - rect.bottom - 18;
        const above = rect.top - 18;
        const openAbove = below < 240 && above > below;
        const available = Math.max(80, openAbove ? above : below);
        menu.style.width = `${width}px`;
        list.style.maxHeight = `${Math.min(280, available - heading.offsetHeight - 14)}px`;
        menu.style.left = `${Math.max(12, Math.min(rect.left, viewportWidth - width - 12))}px`;
        menu.style.top = `${openAbove ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6}px`;
    }

    function setActive(index, scroll = true) {
        if (index < 0 || choices[index]?.disabled) return;
        activeIndex = index;
        rows.forEach((row, rowIndex) => row.classList.toggle('is-active', rowIndex === index));
        trigger.setAttribute('aria-activedescendant', rows[index].id);
        if (scroll) {
            const row = rows[index];
            if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
            if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
                list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
            }
        }
    }

    function open() {
        if (trigger.disabled || !menu.hidden) return;
        closeOpenPicker?.();
        menu.hidden = false;
        wrapper.classList.add('currency-picker-open');
        trigger.setAttribute('aria-expanded', 'true');
        position();
        setActive(choices.findIndex(choice => choice.value === select.value));
        closeOpenPicker = close;
    }

    function close() {
        menu.hidden = true;
        wrapper.classList.remove('currency-picker-open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-activedescendant');
        search = '';
        clearTimeout(searchTimer);
        if (closeOpenPicker === close) closeOpenPicker = undefined;
    }

    function choose(index) {
        const choice = choices[index];
        if (!choice || choice.disabled) return;
        const changed = select.value !== choice.value;
        select.value = choice.value;
        sync();
        close();
        trigger.focus({ preventScroll: true });
        if (changed) {
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('blur', close);
    select.addEventListener('focus', () => trigger.focus());
    select.addEventListener('change', sync);
    menu.addEventListener('pointerdown', event => event.preventDefault());
    document.addEventListener('pointerdown', event => {
        if (!menu.hidden && !wrapper.contains(event.target) && !menu.contains(event.target)) close();
    });
    document.addEventListener('scroll', event => {
        if (!menu.hidden && !menu.contains(event.target)) close();
    }, true);
    window.addEventListener('resize', () => { if (!menu.hidden) position(); });
    trigger.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (menu.hidden) {
                open();
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') return;
            }
            const step = event.key === 'ArrowUp' ? -1 : 1;
            let next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : activeIndex + step;
            while (next >= 0 && next < choices.length && choices[next].disabled) next += step;
            if (next >= 0 && next < choices.length) setActive(next);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (menu.hidden) open();
            else choose(activeIndex);
        } else if (event.key === 'Escape' || event.key === 'Tab') {
            if (!menu.hidden && event.key === 'Escape') event.preventDefault();
            close();
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            open();
            search += event.key.toLowerCase();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { search = ''; }, 700);
            const match = choices.findIndex(choice => !choice.disabled && (choice.code.toLowerCase().startsWith(search) || choice.name.startsWith(search)));
            if (match >= 0) setActive(match);
        }
    });

    sync();
    return { sync, close };
}
