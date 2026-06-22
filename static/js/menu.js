/* menu.js — Matchmaking queue + skin carousel */

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

    // ── Skin carousel ─────────────────────────────────────────────────────
    let currentSkin = typeof USER_SKIN !== 'undefined' ? USER_SKIN : 1;
    const slots     = document.querySelectorAll('.skin-slot');
    const bannerImg = document.getElementById('banner-skin-img');
    const prevBtn   = document.getElementById('skin-prev');
    const nextBtn   = document.getElementById('skin-next');

    function selectSkin(n) {
        currentSkin = n;
        slots.forEach(s => {
            s.classList.toggle('active', parseInt(s.dataset.skin) === n);
        });
        if (bannerImg) {
            bannerImg.src = `/imgs/${n}.png`;
        }
        // Persist to server (fire-and-forget)
        fetch('/skin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `skin=${n}`,
        });
    }

    // Click on any slot
    slots.forEach(slot => {
        slot.addEventListener('click', () => selectSkin(parseInt(slot.dataset.skin)));
    });

    // Arrow buttons
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            const n = currentSkin > 1 ? currentSkin - 1 : SKIN_COUNT;
            selectSkin(n);
            scrollToActiveSkin();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const n = currentSkin < SKIN_COUNT ? currentSkin + 1 : 1;
            selectSkin(n);
            scrollToActiveSkin();
        });
    }

    function scrollToActiveSkin() {
        const active = document.querySelector('.skin-slot.active');
        if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    // Scroll active skin into view on load
    scrollToActiveSkin();
});
