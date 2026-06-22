/* game.js — Board rendering, animations, click state machine */

(function () {
    const wrapper = document.querySelector('[data-room]');
    if (!wrapper) return;

    const ROOM_ID   = wrapper.dataset.room;
    const MY_SIDE   = wrapper.dataset.side;
    const GAME_TYPE = wrapper.dataset.type;

    const socket = io();

    // ── State ─────────────────────────────────────────────────────────────
    let state = 'IDLE'; // IDLE | AWAITING_MOVES | CARD_SELECTED | ANIMATING
    let validMoveMap = {};
    let pendingState = null; // queued game_state while animating

    // ── DOM refs ──────────────────────────────────────────────────────────
    const grid         = document.getElementById('board-grid');
    const turnEl       = document.getElementById('turn-indicator');
    const nameA        = document.getElementById('name-a');
    const nameB        = document.getElementById('name-b');
    const mmrA         = document.getElementById('mmr-a');
    const mmrB         = document.getElementById('mmr-b');
    const rankA        = document.getElementById('rank-a');
    const rankB        = document.getElementById('rank-b');
    const hudSkinImgA  = document.getElementById('hud-skin-img-a');
    const hudSkinImgB  = document.getElementById('hud-skin-img-b');
    const botThinking  = document.getElementById('bot-thinking');
    const gameResult   = document.getElementById('game-result');
    const resultText   = document.getElementById('result-text');
    const resultDetails = document.getElementById('result-details');

    function cellEl(pos) { return document.getElementById('cell-' + pos); }

    // ── Cell centre coords (for spell projectile) ─────────────────────────
    function cellCenter(pos) {
        const el = cellEl(pos);
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    // ── Image helpers ─────────────────────────────────────────────────────
    function cardImage(cellVal, skinA, skinB) {
        if (!cellVal || cellVal === '--' || cellVal === 'XXXXXX') return null;
        const owner    = cellVal[0];
        const isFigure = cellVal.endsWith('F');
        const skin     = owner === 'A' ? skinA : skinB;
        return `/imgs/${skin}${isFigure ? '' : '_'}.png`;
    }

    // ── Board rendering (immediate, no animation) ─────────────────────────
    function applyBoardState(boardGrid, skinA, skinB, hueB, clickableSources, currentTurn) {
        const clickSet = new Set(clickableSources);
        const rows = ['A','B','C'], cols = ['1','2','3','4'];

        rows.forEach((row, ri) => {
            cols.forEach((col, ci) => {
                const pos = row + col;
                const el  = cellEl(pos);
                const val = boardGrid[ri][ci];
                const img = el.querySelector('.card-img');

                el.className = 'cell';
                img.src = '';
                img.style.cssText = '';
                const oldBack = el.querySelector('.card-back');
                if (oldBack) oldBack.remove();

                const isClickable = currentTurn === MY_SIDE && clickSet.has(pos);

                if (val === '--') {
                    el.classList.add('empty-cell');
                    img.style.display = 'none';
                    if (isClickable) el.classList.add('clickable');
                    return;
                }
                if (val === 'XXXXXX') {
                    el.classList.add('destroyed');
                    img.style.display = 'none';
                    const back = document.createElement('div');
                    back.className = 'card-back';
                    el.appendChild(back);
                    if (isClickable) el.classList.add('clickable', 'destroyed-clickable');
                    return;
                }

                const owner    = val[0];
                el.classList.add('owner-' + owner.toLowerCase());

                const imgSrc = cardImage(val, skinA, skinB);
                if (imgSrc) {
                    img.src = imgSrc;
                    img.style.display = '';
                    if (owner === 'B' && hueB) img.style.filter = `hue-rotate(${hueB}deg)`;
                }

                if (isClickable) el.classList.add('clickable');
            });
        });
    }

    // ── Highlight helpers ─────────────────────────────────────────────────
    function clearHighlights() {
        document.querySelectorAll('.cell.selected,.cell.valid-target').forEach(el => {
            el.classList.remove('selected', 'valid-target');
        });
        validMoveMap = {};
    }

    function applyHighlights(position, destinations, moveStrings) {
        clearHighlights();
        const selEl = cellEl(position);
        if (selEl) selEl.classList.add('selected');
        destinations.forEach((dst, i) => {
            const dstEl = cellEl(dst);
            if (dstEl) dstEl.classList.add('valid-target');
            validMoveMap[dst] = moveStrings[i];
        });
    }

    // ── HUD update ────────────────────────────────────────────────────────
    function updateHUD(data) {
        nameA.textContent = data.player_a.username;
        nameB.textContent = data.player_b.username;
        mmrA.textContent  = data.player_a.mmr + ' MMR';
        mmrB.textContent  = data.player_b.mmr + ' MMR';
        rankA.innerHTML = `<span class="rank-badge rank-${data.player_a.rank.toLowerCase()}">${data.player_a.rank}</span>`;
        rankB.innerHTML = `<span class="rank-badge rank-${data.player_b.rank.toLowerCase()}">${data.player_b.rank}</span>`;

        if (hudSkinImgA) hudSkinImgA.src = `/imgs/${data.skin_a}.png`;
        if (hudSkinImgB) {
            hudSkinImgB.src = `/imgs/${data.skin_b}.png`;
            hudSkinImgB.style.filter = data.hue_b ? `hue-rotate(${data.hue_b}deg)` : '';
        }

        const isMyTurn = data.current_turn === MY_SIDE;
        turnEl.textContent = isMyTurn ? 'Your turn'
            : `${MY_SIDE === 'A' ? data.player_b.username : data.player_a.username}'s turn`;
        turnEl.className = 'turn-indicator ' + (isMyTurn ? 'your-turn' : 'opponent-turn');

        const botTurn = GAME_TYPE === 'training' && data.current_turn === 'B' && data.status !== 'finished';
        botThinking && botThinking.classList.toggle('hidden', !botTurn);
    }

    // ════════════════════════════════════════════════════════════════════
    // AUDIO ENGINE (Web Audio API — sem ficheiros externos)
    // ════════════════════════════════════════════════════════════════════

    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playSound(fn) {
        try { fn(getAudioCtx()); } catch(e) { /* suppress audio errors */ }
    }

    // Card flip sound: crisp click + whoosh
    function soundFlip() {
        playSound(ctx => {
            const t = ctx.currentTime;
            // Short white noise (the "click")
            const bufLen = ctx.sampleRate * 0.06;
            const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufLen; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 3);
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buf;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.18, t);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
            noise.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(t);

            // Whoosh tone
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(320, t);
            osc.frequency.exponentialRampToValueAtTime(180, t + 0.12);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.12, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            osc.connect(g);
            g.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.15);
        });
    }

    // Som de shockwave — impacto surdo com ondas
    function soundShockwave() {
        playSound(ctx => {
            const t = ctx.currentTime;
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(90, t);
            osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.35, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

            // Light distortion
            const wave = ctx.createWaveShaper();
            const curve = new Float32Array(256);
            for (let i = 0; i < 256; i++) {
                const x = (i * 2) / 256 - 1;
                curve[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x));
            }
            wave.curve = curve;

            osc.connect(wave);
            wave.connect(g);
            g.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.35);
        });
    }

    // Spell charge sound: rising magical build-up
    function soundSpellCharge() {
        playSound(ctx => {
            const t = ctx.currentTime;
            [0, 0.05, 0.1, 0.15, 0.2].forEach((delay, i) => {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                const freq = 200 + i * 80;
                osc.frequency.setValueAtTime(freq, t + delay);
                osc.frequency.exponentialRampToValueAtTime(freq * 2.5, t + delay + 0.3);
                const g = ctx.createGain();
                g.gain.setValueAtTime(0, t + delay);
                g.gain.linearRampToValueAtTime(0.07, t + delay + 0.05);
                g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.4);
                osc.connect(g);
                g.connect(ctx.destination);
                osc.start(t + delay);
                osc.stop(t + delay + 0.4);
            });
        });
    }

    // Projectile sound: futuristic zap
    function soundProjectile() {
        playSound(ctx => {
            const t = ctx.currentTime;
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, t);
            osc.frequency.exponentialRampToValueAtTime(200, t + 0.25);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.15, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(600, t);
            filter.Q.value = 3;

            osc.connect(filter);
            filter.connect(g);
            g.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.3);
        });
    }

    // Explosion sound: deep boom with crack
    function soundExplosion() {
        playSound(ctx => {
            const t = ctx.currentTime;

            // Sub-bass boom
            const sub = ctx.createOscillator();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(60, t);
            sub.frequency.exponentialRampToValueAtTime(20, t + 0.5);
            const subG = ctx.createGain();
            subG.gain.setValueAtTime(0.5, t);
            subG.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            sub.connect(subG);
            subG.connect(ctx.destination);
            sub.start(t);
            sub.stop(t + 0.5);

            // Crack noise
            const bufLen = ctx.sampleRate * 0.4;
            const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufLen; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 1.5);
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buf;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(2000, t);
            noiseFilter.frequency.exponentialRampToValueAtTime(200, t + 0.4);
            const noiseG = ctx.createGain();
            noiseG.gain.setValueAtTime(0.4, t);
            noiseG.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseG);
            noiseG.connect(ctx.destination);
            noise.start(t);
        });
    }

    // Victory sound: ascending fanfare
    function soundVictory() {
        playSound(ctx => {
            const t = ctx.currentTime;
            const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.value = freq;
                const g = ctx.createGain();
                const start = t + i * 0.12;
                g.gain.setValueAtTime(0, start);
                g.gain.linearRampToValueAtTime(0.2, start + 0.04);
                g.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
                osc.connect(g);
                g.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.5);
            });
        });
    }

    // Som de derrota — descida triste
    function soundDefeat() {
        playSound(ctx => {
            const t = ctx.currentTime;
            const notes = [392, 330, 277, 196]; // G4 E4 C#4 G3
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.value = freq;
                const g = ctx.createGain();
                const start = t + i * 0.18;
                g.gain.setValueAtTime(0, start);
                g.gain.linearRampToValueAtTime(0.18, start + 0.05);
                g.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
                osc.connect(g);
                g.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.6);
            });
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // ANIMATIONS
    // ════════════════════════════════════════════════════════════════════

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Anel de impacto radial
    function spawnImpactRing(el, color = 'rgba(240,160,40,0.9)') {
        const ring = document.createElement('div');
        ring.className = 'impact-ring';
        ring.style.borderColor = color;
        ring.style.boxShadow = `0 0 8px ${color}`;
        el.style.overflow = 'visible';
        el.appendChild(ring);
        setTimeout(() => { ring.remove(); el.style.overflow = ''; }, 500);
    }

    // Light flash overlay for flip (does not affect card image colours)
    function spawnFlipFlash(el) {
        const flash = document.createElement('div');
        flash.className = 'flip-flash';
        el.appendChild(flash);
        setTimeout(() => flash.remove(), 420);
    }

    // Overlay de flash para quake
    function spawnQuakeFlash(el) {
        const flash = document.createElement('div');
        flash.className = 'quake-flash';
        el.appendChild(flash);
        setTimeout(() => flash.remove(), 480);
    }

    // White flash overlay for explosion
    function spawnExplodeFlash(el) {
        const flash = document.createElement('div');
        flash.className = 'explode-flash';
        el.appendChild(flash);
        setTimeout(() => flash.remove(), 580);
    }

    // ── Normal card: flip → shockwave → fade out ─────────────────────────
    async function animateNormal(lastMove, boardGrid, skinA, skinB, hueB) {
        const src      = lastMove.src;
        const affected = lastMove.affected;

        const rows = ['A','B','C'], cols = ['1','2','3','4'];
        const srcRow = rows.indexOf(src[0]);
        const srcCol = cols.indexOf(src[1]);
        const srcFinalVal = (srcRow >= 0 && srcCol >= 0) ? boardGrid[srcRow][srcCol] : null;
        const srcDestroyed = srcFinalVal === 'XXXXXX';

        // 1. Flip
        soundFlip();
        const srcEl = cellEl(src);
        if (srcEl) {
            srcEl.classList.add('anim-flip');
            spawnFlipFlash(srcEl);
            await sleep(150);
            spawnImpactRing(srcEl, 'rgba(240,160,40,0.9)');
        }
        await sleep(180);

        // 2. Shockwave nas adjacentes
        const others = affected.filter(p => p !== src);
        if (others.length > 0) {
            soundShockwave();
            others.forEach((pos, i) => {
                const el = cellEl(pos);
                if (el) setTimeout(() => {
                    el.classList.add('anim-quake');
                    spawnQuakeFlash(el);
                }, i * 70);
            });
            await sleep(others.length * 70 + 300);
        }

        if (srcEl) srcEl.classList.remove('anim-flip');

        // 3. Fade out — only if src was destroyed
        if (srcDestroyed && srcEl) {
            srcEl.classList.add('anim-vanish');
            await sleep(320);
        } else {
            await sleep(80);
        }

        // 4. Estado final
        applyBoardState(boardGrid, skinA, skinB, hueB, [], 'X');

        others.forEach(pos => {
            const el = cellEl(pos);
            if (el) el.classList.remove('anim-quake');
        });
        if (srcEl) srcEl.classList.remove('anim-vanish');

        // Settle nos afetados
        affected.forEach(pos => {
            const el = cellEl(pos);
            if (el) el.classList.add('anim-settle');
        });
        await sleep(300);
        affected.forEach(pos => {
            const el = cellEl(pos);
            if (el) el.classList.remove('anim-settle');
        });
    }

    // ── Figure card: flip → charge → projectile with trail → explosion ──────
    async function animateFigure(lastMove, boardGrid, skinA, skinB, hueB) {
        const src = lastMove.src;
        const dst = lastMove.dst;

        // 1. Figure flip
        soundFlip();
        const srcEl = cellEl(src);
        if (srcEl) {
            srcEl.classList.add('anim-flip');
            spawnFlipFlash(srcEl);
            await sleep(150);
            spawnImpactRing(srcEl, 'rgba(200,60,40,0.9)');
        }
        await sleep(200);
        if (srcEl) srcEl.classList.remove('anim-flip');

        // 2. Charge glow na figura
        soundSpellCharge();
        if (srcEl) srcEl.classList.add('anim-spell-charge');
        await sleep(400);

        // 3. Launch projectile with particle trail
        soundProjectile();
        const fromC = cellCenter(src);
        const toC   = cellCenter(dst);
        const dx    = toC.x - fromC.x;
        const dy    = toC.y - fromC.y;
        const dist  = Math.sqrt(dx*dx + dy*dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const duration = Math.max(280, dist * 0.55);

        const proj = document.createElement('div');
        proj.className = 'spell-projectile';
        proj.style.cssText = `
            left:${fromC.x}px; top:${fromC.y}px;
            --spell-dur:${duration}ms;
            transform: translate(-50%,-50%) rotate(${angle}deg);
            opacity: 0;
        `;
        document.body.appendChild(proj);

        let trailInterval = null;
        requestAnimationFrame(() => {
            proj.style.opacity = '1';
            requestAnimationFrame(() => {
                proj.style.left = `${toC.x}px`;
                proj.style.top  = `${toC.y}px`;
            });
        });

        let trailT = 0;
        trailInterval = setInterval(() => {
            trailT += 40;
            const progress = Math.min(trailT / duration, 1);
            const tx = fromC.x + dx * progress;
            const ty = fromC.y + dy * progress;
            const trail = document.createElement('div');
            trail.className = 'spell-trail';
            const sz = 6 + Math.random() * 7;
            trail.style.cssText = `
                left:${tx}px; top:${ty}px;
                width:${sz}px; height:${sz}px;
                background: radial-gradient(circle, rgba(255,200,80,0.85) 0%, rgba(220,80,20,0.4) 55%, transparent 100%);
            `;
            document.body.appendChild(trail);
            setTimeout(() => trail.remove(), 320);
        }, 40);

        await sleep(duration + 80);
        if (trailInterval) clearInterval(trailInterval);
        proj.style.opacity = '0';
        await sleep(100);
        proj.remove();

        // 4. Explosion on both cells
        soundExplosion();
        [src, dst].forEach(pos => {
            const el = cellEl(pos);
            if (el) {
                el.classList.add('anim-explode');
                spawnExplodeFlash(el);
            }
        });

        await sleep(650);

        // 5. Aplica estado final
        applyBoardState(boardGrid, skinA, skinB, hueB, [], 'X');

        [src, dst].forEach(pos => {
            const el = cellEl(pos);
            if (el) el.classList.remove('anim-spell-charge', 'anim-explode');
        });

        await sleep(100);
    }

    // ── Main animation dispatcher ─────────────────────────────────────────
    async function playAnimation(data) {
        state = 'ANIMATING';
        clearHighlights();

        const lm = data.last_move;
        if (!lm) {
            applyBoardState(data.board, data.skin_a, data.skin_b, data.hue_b,
                            data.clickable_sources, data.current_turn);
            state = 'IDLE';
            return;
        }

        if (lm.is_figure) {
            await animateFigure(lm, data.board, data.skin_a, data.skin_b, data.hue_b);
        } else {
            await animateNormal(lm, data.board, data.skin_a, data.skin_b, data.hue_b);
        }

        // Aplica estado final com clickable_sources corretos
        applyBoardState(data.board, data.skin_a, data.skin_b, data.hue_b,
                        data.clickable_sources, data.current_turn);
        state = 'IDLE';

        // If a new state arrived during animation, process it now
        if (pendingState) {
            const d = pendingState;
            pendingState = null;
            handleGameState(d);
        }
    }

    // ── Click handler ─────────────────────────────────────────────────────
    grid.addEventListener('click', (e) => {
        if (state === 'ANIMATING') return;
        const el = e.target.closest('.cell');
        if (!el) return;
        const pos = el.dataset.pos;

        if (state === 'IDLE' || state === 'CARD_SELECTED') {
            if (el.classList.contains('valid-target') && pos in validMoveMap) {
                const moveStr = validMoveMap[pos];
                clearHighlights();
                state = 'IDLE';
                socket.emit('play_move', { room_id: ROOM_ID, move_str: moveStr });
                return;
            }
            if (el.classList.contains('clickable')) {
                clearHighlights();
                state = 'AWAITING_MOVES';
                socket.emit('request_moves', { room_id: ROOM_ID, position: pos });
                return;
            }
            if (state === 'CARD_SELECTED') {
                clearHighlights();
                state = 'IDLE';
            }
        }
    });

    // ── SocketIO events ───────────────────────────────────────────────────
    socket.on('connect', () => socket.emit('join_game', { room_id: ROOM_ID }));

    function handleGameState(data) {
        updateHUD(data);
        if (state === 'ANIMATING') {
            pendingState = data;
            return;
        }
        if (data.last_move) {
            playAnimation(data);
        } else {
            applyBoardState(data.board, data.skin_a, data.skin_b, data.hue_b,
                            data.clickable_sources, data.current_turn);
            if (state === 'AWAITING_MOVES') state = 'IDLE';
        }
    }

    socket.on('game_state', handleGameState);

    socket.on('legal_moves', (data) => {
        if (data.destinations.length === 1 && data.destinations[0] === data.position) {
            clearHighlights();
            state = 'IDLE';
            socket.emit('play_move', { room_id: ROOM_ID, move_str: data.move_strings[0] });
            return;
        }
        state = 'CARD_SELECTED';
        applyHighlights(data.position, data.destinations, data.move_strings);
    });

    socket.on('game_over', (data) => {
        botThinking && botThinking.classList.add('hidden');
        const isDraw = data.winner === 'DRAW';
        const iWon   = !isDraw && data.winner === MY_SIDE;

        let label, cls;
        if (isDraw)      { label = 'Draw';    cls = 'draw'; }
        else if (iWon)   { label = 'Victory!'; cls = 'win'; }
        else             { label = 'Defeat';   cls = 'loss'; }

        resultText.textContent = label;
        resultText.className   = 'game-result-text ' + cls;

        if (GAME_TYPE === 'ranked' && !isDraw) {
            const delta = MY_SIDE === 'A' ? data.mmr_change_a : data.mmr_change_b;
            resultDetails.textContent = `MMR: ${delta >= 0 ? '+' : ''}${delta}`;
        } else if (GAME_TYPE === 'ranked' && isDraw) {
            resultDetails.textContent = 'Draw — no MMR change.';
        } else {
            resultDetails.textContent = 'Training game. MMR not affected.';
        }

        setTimeout(() => {
            if (iWon) soundVictory();
            else if (!isDraw) soundDefeat();
        }, 200);

        gameResult && gameResult.classList.remove('hidden');
    });

    socket.on('error', (data) => {
        console.warn('Server error:', data.message);
        state = 'IDLE';
        clearHighlights();
    });
})();
