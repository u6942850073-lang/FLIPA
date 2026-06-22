/* menu.js — Matchmaking queue + skin picker */

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

        // Update all hidden slot data nodes
        slots.forEach(s => {
            s.classList.toggle('active', parseInt(s.dataset.skin) === n);
        });

        // Update banner preview (top-left icon)
        if (bannerImg) bannerImg.src = `/imgs/${n}.png`;

        // Update picker central image + counter
        if (pickerImg)  pickerImg.src = `/imgs/${n}.png`;
        if (pickerCur)  pickerCur.textContent = n;

        // Persist to server (fire-and-forget)
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

    // Touch swipe support on the picker image
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
});
