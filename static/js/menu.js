/* menu.js — Matchmaking queue + skin picker + theme picker + effect pack picker */

// Theme palette: [bg, panel, accent] for each theme index (1-based)
const THEME_PALETTES = [
    null, // index 0 unused
    { bg: '#161310', accent: '#e8a020', name: 'Ink & Ember' },
    { bg: '#0c1820', accent: '#20a0c8', name: 'Ocean Depths' },
    { bg: '#101a10', accent: '#40b840', name: 'Forest Shadow' },
    { bg: '#180c10', accent: '#e02840', name: 'Blood Moon' },
    { bg: '#100c1e', accent: '#9040e0', name: 'Void Purple' },
    { bg: '#101620', accent: '#80c8f8', name: 'Arctic Frost' },
    { bg: '#08120a', accent: '#20ff60', name: 'Toxic Neon' },
    { bg: '#1a0c10', accent: '#e03818', name: 'Crimson Dusk' },
    { bg: '#10141c', accent: '#6888c8', name: 'Deep Slate' },
    { bg: '#1a1018', accent: '#e060a0', name: 'Sakura Night' },
];

const EFFECT_PACK_NAMES = [null, 'Ember', 'Crystal', 'Shadow', 'Lightning', 'Void', 'Water', 'Fire', 'Rainbow', 'Matrix', 'Bombastic'];

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // ── Ranked matchmaking ────────────────────────────────────────────────
    const findBtn      = document.getElementById('find-game-btn');
    const cancelBtn    = document.getElementById('cancel-queue-btn');
    const idleDiv      = document.getElementById('ranked-idle');
    const searchingDiv = document.getElementById('ranked-searching');

    if (findBtn) {
        findBtn.addEventListener('click', () => socket.emit('join_queue'));
        cancelBtn.addEventListener('click', () => socket.emit('leave_queue'));
    }

    socket.on('queue_update', (data) => {
        idleDiv.classList.toggle('hidden', data.in_queue);
        searchingDiv.classList.toggle('hidden', !data.in_queue);
    });

    socket.on('matched', (data) => {
        window.location.href = '/game/' + data.room_id;
    });

    // ── Skin picker ───────────────────────────────────────────────────────
    let currentSkin   = typeof USER_SKIN !== 'undefined' ? USER_SKIN : 1;
    const skinCount   = typeof SKIN_COUNT !== 'undefined' ? SKIN_COUNT : 9;
    const slots       = document.querySelectorAll('.skin-slot');
    const bannerImg   = document.getElementById('banner-skin-img');
    const pickerImg   = document.getElementById('skin-picker-img');
    const pickerCur   = document.getElementById('skin-picker-current');
    const prevBtn     = document.getElementById('skin-prev');
    const nextBtn     = document.getElementById('skin-next');

    function selectSkin(n) {
        currentSkin = n;
        slots.forEach(s => {
            s.classList.toggle('active', parseInt(s.dataset.skin) === n);
        });
        if (bannerImg) bannerImg.src = `/imgs/${n}.png`;
        if (pickerImg)  pickerImg.src = `/imgs/${n}.png`;
        if (pickerCur)  pickerCur.textContent = n;
        fetch('/skin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `skin=${n}`,
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            selectSkin(currentSkin > 1 ? currentSkin - 1 : skinCount);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            selectSkin(currentSkin < skinCount ? currentSkin + 1 : 1);
        });
    }

    if (pickerImg) {
        let touchStartX = 0;
        pickerImg.parentElement.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].clientX;
        }, { passive: true });
        pickerImg.parentElement.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(dx) > 40) {
                selectSkin(dx < 0
                    ? (currentSkin < skinCount ? currentSkin + 1 : 1)
                    : (currentSkin > 1 ? currentSkin - 1 : skinCount));
            }
        }, { passive: true });
    }

    // ── Theme picker ──────────────────────────────────────────────────────
    let currentTheme   = typeof USER_THEME !== 'undefined' ? USER_THEME : 1;
    const themeCount   = typeof THEME_COUNT !== 'undefined' ? THEME_COUNT : 8;
    const themePrev    = document.getElementById('theme-prev');
    const themeNext    = document.getElementById('theme-next');
    const themeSwatchBg     = document.getElementById('theme-swatch-bg');
    const themeSwatchAccent = document.getElementById('theme-swatch-accent');
    const themePickerCur    = document.getElementById('theme-picker-current');
    const htmlEl            = document.documentElement;

    function applyThemeSwatch(n) {
        const p = THEME_PALETTES[n];
        if (!p) return;
        if (themeSwatchBg)     themeSwatchBg.style.background = p.bg;
        if (themeSwatchAccent) themeSwatchAccent.style.background = p.accent;
        if (themePickerCur)    themePickerCur.textContent = n;
    }

    function selectTheme(n) {
        currentTheme = n;
        htmlEl.setAttribute('data-theme', n);
        applyThemeSwatch(n);
        fetch('/theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `theme=${n}`,
        });
    }

    // Init swatch on load
    applyThemeSwatch(currentTheme);

    if (themePrev) {
        themePrev.addEventListener('click', () => {
            selectTheme(currentTheme > 1 ? currentTheme - 1 : themeCount);
        });
    }
    if (themeNext) {
        themeNext.addEventListener('click', () => {
            selectTheme(currentTheme < themeCount ? currentTheme + 1 : 1);
        });
    }

    // Touch swipe on swatch
    const swatchWrap = document.getElementById('theme-swatch');
    if (swatchWrap) {
        let tStartX = 0;
        swatchWrap.addEventListener('touchstart', e => {
            tStartX = e.changedTouches[0].clientX;
        }, { passive: true });
        swatchWrap.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - tStartX;
            if (Math.abs(dx) > 40) {
                selectTheme(dx < 0
                    ? (currentTheme < themeCount ? currentTheme + 1 : 1)
                    : (currentTheme > 1 ? currentTheme - 1 : themeCount));
            }
        }, { passive: true });
    }

    // ── Effect Pack picker ────────────────────────────────────────────────
    let currentEP    = typeof USER_EFFECT_PACK !== 'undefined' ? USER_EFFECT_PACK : 1;
    const epCount    = typeof EFFECT_PACK_COUNT !== 'undefined' ? EFFECT_PACK_COUNT : 4;
    const epPrev     = document.getElementById('ep-prev');
    const epNext     = document.getElementById('ep-next');
    const epSwatch   = document.getElementById('ep-swatch');
    const epPackName = document.getElementById('ep-pack-name');
    const epPickerCur= document.getElementById('ep-picker-current');

    function selectEffectPack(n) {
        currentEP = n;
        if (epSwatch)    epSwatch.dataset.ep = n;
        if (epPackName)  epPackName.textContent = EFFECT_PACK_NAMES[n] || n;
        if (epPickerCur) epPickerCur.textContent = n;
        fetch('/effect-pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `effect_pack=${n}`,
        });
    }

    // Init on load
    if (epPackName) epPackName.textContent = EFFECT_PACK_NAMES[currentEP] || currentEP;

    if (epPrev) {
        epPrev.addEventListener('click', () => {
            selectEffectPack(currentEP > 1 ? currentEP - 1 : epCount);
        });
    }
    if (epNext) {
        epNext.addEventListener('click', () => {
            selectEffectPack(currentEP < epCount ? currentEP + 1 : 1);
        });
    }

    // Touch swipe on ep swatch
    if (epSwatch) {
        let epTStartX = 0;
        epSwatch.addEventListener('touchstart', e => {
            epTStartX = e.changedTouches[0].clientX;
        }, { passive: true });
        epSwatch.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - epTStartX;
            if (Math.abs(dx) > 40) {
                selectEffectPack(dx < 0
                    ? (currentEP < epCount ? currentEP + 1 : 1)
                    : (currentEP > 1 ? currentEP - 1 : epCount));
            }
        }, { passive: true });
    }
});
