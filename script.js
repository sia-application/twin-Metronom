// Audio Context and Global State
let audioContext = null;
let isPlaying = false;
let metronomes = [];
let schedulerTimer = null;
let nextNoteTime = 0;
let scheduleAheadTime = 0.1;
let lookahead = 25;
let audioUnlocked = false;

// Unlock AudioContext for iOS
function unlockAudio() {
    if (audioUnlocked) return;

    // 1. Resume Web Audio Context
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log('AudioContext resumed successfully');
        });
    }

    // 2. Play a silent buffer to fully unlock Web Audio
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);

    // 3. Play a silent HTML5 Audio element to force iOS Audio Session to "Playback"
    // This allows sound even when the hardware mute switch is on.
    const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAGZGF0YQQAAAAAAA==");
    silentAudio.play().then(() => {
        console.log('Silent HTML5 audio played, forcing Playback session');
    }).catch(e => {
        console.warn('Silent HTML5 audio play failed', e);
    });

    audioUnlocked = true;

    // Remove listeners once unlocked
    document.removeEventListener('touchstart', unlockAudio);
    document.removeEventListener('click', unlockAudio);
}

// Add unlock listeners
document.addEventListener('touchstart', unlockAudio, { passive: false });
document.addEventListener('click', unlockAudio);

// DOM Elements
const playBtn = document.getElementById('play-btn');
const addMetronomeBtn = document.getElementById('add-metronome-btn');
const metronomesContainer = document.getElementById('metronomes-container');
const metronomeTemplate = document.getElementById('metronome-template');

// Pattern Definitions
const patterns = {
    'quarter': { beats: 4, subdivisions: 1, notes: [1, 1, 1, 1] },
    'three-four': { beats: 3, subdivisions: 1, notes: [1, 1, 1] },

    'triplet': { beats: 3, subdivisions: 1, notes: [1, 1, 1] },
    'triplet-hollow': { beats: 3, subdivisions: 1, notes: [1, 0, 1] },
    'sextuplet': { beats: 6, subdivisions: 1, notes: [1, 1, 1, 1, 1, 1] }
};

class Metronome {
    constructor(id) {
        this.id = id;
        this.tempo = 120;
        this.currentPattern = 'quarter';
        this.clickMultiplier = 1;
        this.offbeatMultiplier = 1;
        this.currentBeat = 0;
        this.isOffbeat = false;
        this.accentEnabled = true;
        this.volume = 1.0;
        this.offbeatVolume = 0.0;
        this.pitch = 800; // Default pitch
        this.isPlaying = false; // Individual playing state
        this.mutedBeats = new Set(); // Store indices of muted beats
        this.mutedOffbeats = new Set(); // Store indices of muted offbeats

        // Rhythm Practice State
        this.practiceMode = 'main'; // main, offbeat, both
        this.expectedHits = [];
        this.evaluationCounts = {
            excellent: 0,
            great: 0,
            nice: 0,
            miss: 0
        };

        this.element = this.createUI();
        this.setupEventListeners();
    }

    createUI() {
        const clone = metronomeTemplate.content.cloneNode(true);
        const unit = clone.querySelector('.metronome-unit');

        // Append to container
        metronomesContainer.appendChild(unit);
        return unit;
    }

    remove() {
        this.element.remove();
        metronomes = metronomes.filter(m => m !== this);
    }

    setupEventListeners() {
        const el = this.element;

        // Removing
        el.querySelector('.remove-btn').addEventListener('click', () => {
            if (this.isPlaying) this.toggle(); // Stop if playing
            this.remove();
        });

        // Individual Play
        const playBtn = el.querySelector('.unit-play-btn');
        playBtn.addEventListener('click', () => this.toggle());

        // Tempo
        const tempoInput = el.querySelector('.tempo-input');
        const tempoSlider = el.querySelector('.tempo-slider');
        const updateTempo = (val) => {
            let v = parseInt(val);
            if (isNaN(v)) v = this.tempo; // Revert to current if invalid
            v = Math.max(5, Math.min(999, v));
            this.tempo = v;
            tempoInput.value = v;
            tempoSlider.value = v;
        };

        tempoInput.addEventListener('focus', (e) => e.target.value = '');
        tempoInput.addEventListener('change', (e) => updateTempo(e.target.value));
        tempoSlider.addEventListener('input', (e) => updateTempo(e.target.value));
        el.querySelector('.tempo-down').addEventListener('click', () => updateTempo(this.tempo - 1));
        el.querySelector('.tempo-up').addEventListener('click', () => updateTempo(this.tempo + 1));

        // TAP BPM
        const tapBtn = el.querySelector('.tap-btn');
        let lastTapTime = 0;
        let tapIntervals = [];

        tapBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const now = Date.now();

            // Reset if too long between taps (2 seconds)
            if (now - lastTapTime > 2000) {
                tapIntervals = [];
            } else {
                const interval = now - lastTapTime;
                tapIntervals.push(interval);

                // Keep last 4 intervals for average
                if (tapIntervals.length > 4) tapIntervals.shift();

                // Calculate average
                if (tapIntervals.length >= 2) {
                    const avgInterval = tapIntervals.reduce((a, b) => a + b) / tapIntervals.length;
                    const bpm = Math.round(60000 / avgInterval);
                    updateTempo(bpm);
                }
            }
            lastTapTime = now;

            // Visual feedback
            tapBtn.style.transform = 'scale(0.95)';
            setTimeout(() => tapBtn.style.transform = '', 100);
        });

        // Rhythm Patterns
        const rhythmBtns = el.querySelectorAll('.rhythm-btn');
        rhythmBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                rhythmBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentPattern = btn.dataset.pattern;
                this.currentBeat = 0;
                this.mutedBeats.clear(); // Reset mutes on pattern change
                this.mutedOffbeats.clear();
                this.updateBeatDots();
            });
        });

        // Volume
        const volSlider = el.querySelector('.volume-slider');
        const volDisplay = el.querySelector('.volume-display');
        const muteBtn = el.querySelector('.main-mute-btn');

        const updateVol = (val) => {
            this.volume = parseInt(val) / 100;
            volSlider.value = val;
            volDisplay.textContent = val + '%';
            muteBtn.textContent = this.volume === 0 ? '🔇' : '🔈';
            muteBtn.classList.toggle('muted', this.volume === 0);
        };

        volSlider.addEventListener('input', (e) => updateVol(e.target.value));
        muteBtn.addEventListener('click', () => updateVol(Math.max(0, parseInt(volSlider.value) - 100)));
        el.querySelector('.main-volume-up').addEventListener('click', () => updateVol(Math.min(500, parseInt(volSlider.value) + 100)));

        // Offbeat Volume
        const offSlider = el.querySelector('.offbeat-volume-slider');
        const offDisplay = el.querySelector('.offbeat-volume-display');
        const offMuteBtn = el.querySelector('.offbeat-mute-btn');

        const updateOffVol = (val) => {
            this.offbeatVolume = parseInt(val) / 100;
            offSlider.value = val;
            offDisplay.textContent = val + '%';
            offMuteBtn.textContent = this.offbeatVolume === 0 ? '🔇' : '🔈';
            offMuteBtn.classList.toggle('muted', this.offbeatVolume === 0);
        };

        offSlider.addEventListener('input', (e) => updateOffVol(e.target.value));
        offMuteBtn.addEventListener('click', () => updateOffVol(Math.max(0, parseInt(offSlider.value) - 10)));
        el.querySelector('.offbeat-volume-up').addEventListener('click', () => updateOffVol(Math.min(500, parseInt(offSlider.value) + 10)));

        // Multipliers
        const multBtns = el.querySelectorAll('.multiplier-btn');
        multBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                multBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.clickMultiplier = parseInt(btn.dataset.multiplier);
            });
        });

        const offMultBtns = el.querySelectorAll('.offbeat-mult-btn');
        offMultBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                offMultBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.offbeatMultiplier = parseInt(btn.dataset.multiplier);
            });
        });

        // Pitch Control
        const pitchSlider = el.querySelector('.pitch-slider');
        const pitchDisplay = el.querySelector('.pitch-display');

        const updatePitch = (val) => {
            let v = parseInt(val);
            v = Math.max(200, Math.min(2000, v));
            this.pitch = v;
            pitchSlider.value = v;
            pitchDisplay.textContent = v + 'Hz';
        };

        if (pitchSlider) {
            pitchSlider.addEventListener('input', (e) => updatePitch(e.target.value));
            el.querySelector('.pitch-down').addEventListener('click', () => updatePitch(this.pitch - 50));
            el.querySelector('.pitch-up').addEventListener('click', () => updatePitch(this.pitch + 50));
        }

        // Toggles
        const offToggle = el.querySelector('.offbeat-toggle');
        offToggle.addEventListener('click', () => {
            this.isOffbeat = !this.isOffbeat;
            offToggle.classList.toggle('offbeat', this.isOffbeat);
            this.updateBeatDots();
        });

        const accToggle = el.querySelector('.accent-toggle');
        accToggle.addEventListener('click', () => {
            this.accentEnabled = !this.accentEnabled;
            accToggle.classList.toggle('active', this.accentEnabled);
        });

        // Visual Mode Toggle
        this.visualMode = 'main'; // Default
        const visToggle = el.querySelector('.visual-mode-toggle');
        const visValue = el.querySelector('.visual-mode-value');
        const visLabel = el.querySelector('.visual-mode-label');

        if (visToggle) {
            visToggle.addEventListener('click', (e) => {
                e.preventDefault(); // Safety

                // Cycle modes
                if (this.visualMode === 'both') {
                    this.visualMode = 'main';
                } else if (this.visualMode === 'main') {
                    this.visualMode = 'offbeat';
                } else {
                    this.visualMode = 'both';
                }

                visToggle.dataset.mode = this.visualMode;
                this.updateBeatDots();

                // Update Text
                const textMap = {
                    'main': '表拍のみ',
                    'offbeat': '裏拍のみ',
                    'both': '両拍'
                };

                if (visValue) {
                    visValue.textContent = textMap[this.visualMode];
                } else if (visLabel) {
                    // Fallback for cached HTML
                    visLabel.textContent = `表示設定: ${textMap[this.visualMode]}`;
                }
            });
        }

        // Initialize Dots
        this.updateBeatDots();

        // Detail Settings Toggle
        const detailToggle = el.querySelector('.main-detail-toggle');
        const detailSettings = el.querySelector('.detail-settings');

        if (detailToggle && detailSettings) {
            detailToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Detail toggle clicked');
                detailSettings.classList.toggle('open');
                const isOpen = detailSettings.classList.contains('open');
                detailToggle.textContent = isOpen ? '詳細設定 ▲' : '詳細設定 ▼';
            });
        } else {
            console.error('Detail toggle elements not found');
        }

        // Rhythm Practice Controls
        const practiceToggle = el.querySelector('.rhythm-practice-toggle');
        const practiceSettings = el.querySelector('.rhythm-practice-settings');
        const practiceTap = el.querySelector('.practice-tap-area');
        const resetBtn = el.querySelector('.evaluation-reset-btn');
        const practiceModeBtns = el.querySelectorAll('.practice-mode-btn');

        if (practiceToggle && practiceSettings) {
            practiceToggle.addEventListener('click', (e) => {
                e.preventDefault();
                practiceSettings.classList.toggle('open');
                const isOpen = practiceSettings.classList.contains('open');
                practiceToggle.textContent = isOpen ? 'リズム練習 ▲' : 'リズム練習 ▼';
            });
        }

        if (practiceTap) {
            // Use touchstart for lower latency on mobile, mousedown for desktop
            const handleTap = (e) => {
                e.preventDefault(); // Prevent double firing
                this.evaluateTap();
                // Visual feedback
                practiceTap.style.transform = 'scale(0.95)';
                setTimeout(() => practiceTap.style.transform = '', 50);
            };
            practiceTap.addEventListener('touchstart', handleTap, { passive: false });
            practiceTap.addEventListener('mousedown', handleTap);
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const textEl = el.querySelector('.evaluation-text');
                if (textEl) {
                    textEl.textContent = '---';
                    textEl.className = 'evaluation-text';
                }

                // Reset counts
                this.evaluationCounts = { excellent: 0, great: 0, nice: 0, miss: 0 };
                this.updateCountDisplay();
            });
        }

        if (practiceModeBtns) {
            practiceModeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    practiceModeBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.practiceMode = btn.dataset.mode;
                });
            });
        }
    }

    updateBeatDots() {
        const container = this.element.querySelector('.beat-dots');
        const pattern = patterns[this.currentPattern];
        container.innerHTML = '';

        // Apply current mode class
        container.className = 'beat-dots'; // Reset
        if (this.visualMode === 'main') container.classList.add('mode-main-only');
        else if (this.visualMode === 'offbeat') container.classList.add('mode-offbeat-only');
        else container.classList.add('mode-both');

        for (let i = 0; i < pattern.beats; i++) {
            // Main beat dot
            const dot = document.createElement('span');
            dot.className = 'dot';
            if (pattern.notes[i] === 0) dot.style.opacity = '0.3';

            // Check if muted
            if (this.mutedBeats.has(i)) {
                dot.classList.add('muted');
            }

            // Click to toggle mute
            dot.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent bubbling if needed
                if (this.mutedBeats.has(i)) {
                    this.mutedBeats.delete(i);
                    dot.classList.remove('muted');
                } else {
                    this.mutedBeats.add(i);
                    dot.classList.add('muted');
                }
            });

            container.appendChild(dot);

            // Offbeat dot
            const offDot = document.createElement('span');
            offDot.className = 'offbeat-dot';

            // Check if muted
            if (this.mutedOffbeats.has(i)) {
                offDot.classList.add('muted');
            }

            // Click to toggle mute
            offDot.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mutedOffbeats.has(i)) {
                    this.mutedOffbeats.delete(i);
                    offDot.classList.remove('muted');
                } else {
                    this.mutedOffbeats.add(i);
                    offDot.classList.add('muted');
                }
            });

            if (this.isOffbeat) {
                container.appendChild(offDot);
                container.appendChild(dot);
            } else {
                container.appendChild(dot);
                container.appendChild(offDot);
            }
        }
    }

    visualizeBeat(beatNumber, duration) {
        const dots = this.element.querySelectorAll('.dot');
        dots.forEach((dot, i) => {
            dot.classList.remove('active', 'first');
            if (i === beatNumber) {
                dot.classList.add('active');
                if (i === 0) dot.classList.add('first');

                // Auto turn off ONLY if mode is 'both'
                if (this.visualMode === 'both') {
                    setTimeout(() => {
                        dot.classList.remove('active', 'first');
                    }, duration);
                }
            }
        });
    }

    visualizeOffbeat(beatNumber, duration) {
        const offDots = this.element.querySelectorAll('.offbeat-dot');
        offDots.forEach((dot, i) => {
            dot.classList.remove('active');
            if (i === beatNumber) {
                dot.classList.add('active');

                // Auto turn off ONLY if mode is 'both'
                if (this.visualMode === 'both') {
                    setTimeout(() => {
                        dot.classList.remove('active');
                    }, duration);
                }
            }
        });
    }

    clearVisuals() {
        this.element.querySelectorAll('.dot').forEach(d => d.classList.remove('active', 'first'));
        this.element.querySelectorAll('.offbeat-dot').forEach(d => d.classList.remove('active'));
    }

    addExpectedHit(time, type) {
        // Keep only recent and future hits
        const now = audioContext ? audioContext.currentTime : 0;

        // Cleanup old hits (older than 1 sec)
        if (this.expectedHits.length > 50 || (this.expectedHits.length > 0 && this.expectedHits[0].time < now - 1.0)) {
            this.expectedHits = this.expectedHits.filter(h => h.time > now - 1.0);
        }

        this.expectedHits.push({ time, type });
    }

    evaluateTap() {
        if (!audioContext || !this.isPlaying) return;

        const now = audioContext.currentTime;

        // Filter relevant hits based on mode
        let relevantHits = this.expectedHits;
        if (this.practiceMode === 'main') {
            relevantHits = relevantHits.filter(h => h.type === 'main');
        } else if (this.practiceMode === 'offbeat') {
            relevantHits = relevantHits.filter(h => h.type === 'offbeat');
        }
        // 'both' uses all

        if (relevantHits.length === 0) return;

        // Find closest
        let closest = null;
        let minDiff = Infinity;

        relevantHits.forEach(hit => {
            const diff = Math.abs(hit.time - now);
            if (diff < minDiff) {
                minDiff = diff;
                closest = hit;
            }
        });

        if (closest) {
            this.displayEvaluation(minDiff);
        }
    }

    displayEvaluation(diff) {
        const textEl = this.element.querySelector('.evaluation-text');
        if (!textEl) return;

        let result = '';
        let className = 'evaluation-text';

        // Windows (seconds)
        if (diff <= 0.04) { // slightly loose for web audio latency variation
            result = 'EXCELLENT!!';
            className += ' excellent';
        } else if (diff <= 0.08) {
            result = 'GREAT!';
            className += ' great';
        } else if (diff <= 0.12) {
            result = 'NICE';
            className += ' nice';
        } else {
            result = 'MISS...';
            className += ' miss';
            // Increase miss count (if initialized)
            if (this.evaluationCounts) this.evaluationCounts.miss++;
        }

        // Initialize if somehow missing
        if (!this.evaluationCounts) {
            this.evaluationCounts = { excellent: 0, great: 0, nice: 0, miss: 0 };
        }

        // Increment counts based on result
        if (result.includes('EXCELLENT')) this.evaluationCounts.excellent++;
        else if (result.includes('GREAT')) this.evaluationCounts.great++;
        else if (result.includes('NICE')) this.evaluationCounts.nice++;

        this.updateCountDisplay();

        // Re-trigger animation
        textEl.classList.remove('excellent', 'great', 'nice', 'miss');
        void textEl.offsetWidth; // Trigger reflow
        textEl.textContent = result;
        textEl.className = className;
    }

    updateCountDisplay() {
        const counts = this.element.querySelectorAll('.count-value');
        counts.forEach(c => {
            const type = c.dataset.type;
            if (this.evaluationCounts[type] !== undefined) {
                c.textContent = this.evaluationCounts[type];
            }
        });
    }

    toggle() {
        this.isPlaying = !this.isPlaying;
        const btn = this.element.querySelector('.unit-play-btn');

        if (this.isPlaying) {
            btn.classList.add('playing');
            btn.textContent = '■';

            // If global scheduler isn't running, start it
            // We check if "playing" flag is false to know if we need to start
            if (!isPlaying) {
                // Ensure audio context is ready
                if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
                if (audioContext.state === 'suspended') audioContext.resume();

                // Sync start time
                const now = audioContext.currentTime;
                this.nextNoteTime = now + 0.05;
                this.currentBeat = 0;

                startSchedulerLoop();
            } else {
                // Join existing loop
                this.nextNoteTime = audioContext.currentTime + 0.05;
                this.currentBeat = 0;
            }
        } else {
            btn.classList.remove('playing');
            btn.textContent = '▶';
            this.clearVisuals();

            // If no metronomes are playing, stop scheduler
            checkAutoStop();
        }
        updateGlobalPlayState();
    }
}


// Global Scheduler State Management
function startSchedulerLoop() {
    if (!schedulerTimer) {
        scheduler();
        updateGlobalPlayState();
    }
}

function checkAutoStop() {
    const anyPlaying = metronomes.some(m => m.isPlaying);
    if (!anyPlaying) {
        clearTimeout(schedulerTimer);
        schedulerTimer = null;
    }
}

function updateGlobalPlayState() {
    const anyPlaying = metronomes.some(m => m.isPlaying);
    isPlaying = anyPlaying; // Sync global flag

    if (isPlaying) {
        playBtn.classList.add('playing');
        playBtn.querySelector('.play-icon').textContent = '■';
        playBtn.querySelector('.btn-text').textContent = 'すべてストップ';
    } else {
        playBtn.classList.remove('playing');
        playBtn.querySelector('.play-icon').textContent = '▶';
        playBtn.querySelector('.btn-text').textContent = 'すべてスタート';
    }
}


// Scheduler Logic
function scheduler() {

    // Correct loop implementation inside scheduler function:
    // Correct loop implementation inside scheduler function:
    metronomes.forEach(m => {
        if (!m.isPlaying) return; // Skip if not playing

        // Initialize nextNoteTime for new metronomes if needed, or track it on the instance
        if (!m.nextNoteTime) m.nextNoteTime = audioContext.currentTime + 0.1;

        while (m.nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
            scheduleMetronomeNote(m, m.nextNoteTime);
            advanceMetronomeNote(m);
        }
    });

    // Continue loop if anyone is playing
    if (metronomes.some(m => m.isPlaying)) {
        schedulerTimer = setTimeout(scheduler, lookahead);
    } else {
        schedulerTimer = null;
    }
}

function scheduleMetronomeNote(metronome, time) {
    const pattern = patterns[metronome.currentPattern];
    const beatNumber = metronome.currentBeat;

    // Durations
    let beatDuration = 60.0 / metronome.tempo; // Quarter
    if (metronome.currentPattern === 'sextuplet') beatDuration /= 6;

    else if (metronome.currentPattern === 'triplet' || metronome.currentPattern === 'triplet-hollow') beatDuration /= 3; // Triplet variants
    // three-four and quarter default to beatDuration (quarter note)

    const mainInterval = beatDuration / metronome.clickMultiplier;
    const offInterval = beatDuration / metronome.offbeatMultiplier;
    const offset = mainInterval / 2;

    let mainStart = metronome.isOffbeat ? time + offset : time;
    let offStart = metronome.isOffbeat ? time : time + offset;

    // Calculate visual duration (60% of half interval to ensure gap)
    const visualDuration = (mainInterval / 2) * 1000 * 0.6;

    // Record expected hits for practice
    if (metronome.isPlaying) {
        // Main beat
        if (!metronome.mutedBeats.has(beatNumber) && pattern.notes[beatNumber] !== 0) {
            for (let i = 0; i < metronome.clickMultiplier; i++) {
                metronome.addExpectedHit(mainStart + i * mainInterval, 'main');
            }
        }
        // Off beat
        if (!metronome.mutedOffbeats.has(beatNumber) && pattern.notes[beatNumber] !== 0) {
            for (let i = 0; i < metronome.offbeatMultiplier; i++) {
                metronome.addExpectedHit(offStart + i * offInterval, 'offbeat');
            }
        }
    }

    // Main Visuals
    setTimeout(() => {
        if (isPlaying && metronome.isPlaying) metronome.visualizeBeat(beatNumber, visualDuration);
    }, (mainStart - audioContext.currentTime) * 1000);

    // Offbeat Visuals
    setTimeout(() => {
        if (isPlaying && metronome.isPlaying) metronome.visualizeOffbeat(beatNumber, visualDuration);
    }, (offStart - audioContext.currentTime) * 1000);

    if (pattern.notes[beatNumber] === 0) return;

    // Main Sounds
    if (metronome.volume > 0) {
        // Skip if this beat is muted
        if (!metronome.mutedBeats.has(beatNumber)) {
            for (let i = 0; i < metronome.clickMultiplier; i++) {
                playTone(mainStart + i * mainInterval,
                    (beatNumber === 0 && i === 0 && metronome.accentEnabled) ? metronome.pitch + 200 : metronome.pitch,
                    metronome.volume, 'square');
            }
        }
    }

    // Offbeat Sounds
    if (metronome.offbeatVolume > 0) {
        if (!metronome.mutedOffbeats.has(beatNumber)) {
            for (let i = 0; i < metronome.offbeatMultiplier; i++) {
                playTone(offStart + i * offInterval, 600, metronome.offbeatVolume, 'square');
            }
        }
    }
}

function playTone(time, freq, vol, type) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.05);
}

function advanceMetronomeNote(metronome) {
    const pattern = patterns[metronome.currentPattern];
    let duration = 60.0 / metronome.tempo;
    if (metronome.currentPattern === 'sextuplet') duration /= 6;

    else if (metronome.currentPattern === 'triplet' || metronome.currentPattern === 'triplet-hollow') duration /= 3;

    metronome.nextNoteTime += duration;
    metronome.currentBeat = (metronome.currentBeat + 1) % pattern.beats;
}



// Global Controls
async function togglePlay() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Ensure context is running
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    // Checking if any are playing
    const anyPlaying = metronomes.some(m => m.isPlaying);

    if (anyPlaying) {
        // STOP ALL
        metronomes.forEach(m => {
            if (m.isPlaying) m.toggle();
        });
    } else {
        // START ALL
        const now = audioContext.currentTime;
        const startDelay = 0.05;

        // Start everyone
        metronomes.forEach(m => {
            // We manually set state to avoid toggling logic interfering with sync start
            m.isPlaying = true;
            m.currentBeat = 0;
            m.nextNoteTime = now + startDelay;

            // Update UI for each
            const btn = m.element.querySelector('.unit-play-btn');
            btn.classList.add('playing');
            btn.textContent = '⏹';
        });

        startSchedulerLoop();
    }
}

function addMetronome() {
    const m = new Metronome(Date.now());
    metronomes.push(m);
}

// Init
playBtn.addEventListener('click', togglePlay);
addMetronomeBtn.addEventListener('click', addMetronome);

// Initialize presets on load (moved here appropriately or just keep distinct calls)
// Add initial metronome
// Add initial metronome
addMetronome();

// Preset Toggle
const presetToggleBtn = document.getElementById('preset-toggle-btn');
const presetSection = document.getElementById('preset-section');
const presetContentBody = document.getElementById('preset-content-body');

if (presetToggleBtn && presetSection && presetContentBody) {
    presetToggleBtn.addEventListener('click', () => {
        const isOpen = presetContentBody.classList.toggle('open');
        presetSection.classList.toggle('open', isOpen);
        presetToggleBtn.textContent = isOpen ? 'プリセット ▲' : 'プリセット ▼';
    });
}

// Initial display setup if needed (default close is handled by CSS)

// ==========================================
// Preset Management
// ==========================================

const PRESET_STORAGE_KEY = 'maltinome_presets';

// Preset DOM Elements
const folderSelect = document.getElementById('folder-select');
const presetSelect = document.getElementById('preset-select');

// Save Controls
const saveFolderSelect = document.getElementById('save-folder-select');
const newFolderInput = document.getElementById('new-folder-input');
const presetNameInput = document.getElementById('preset-name-input');
const savePresetBtn = document.getElementById('save-preset-btn');

// Action Buttons
const loadPresetBtn = document.getElementById('load-preset-btn');
const deletePresetBtn = document.getElementById('delete-preset-btn');

// Toast notification element
let toastElement = null;

function createToast() {
    if (!toastElement) {
        toastElement = document.createElement('div');
        toastElement.className = 'toast';
        document.body.appendChild(toastElement);
    }
    return toastElement;
}

function showToast(message, type = 'info') {
    const toast = createToast();
    toast.textContent = message;
    toast.className = `toast ${type}`;

    // Trigger show
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Hide after delay
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

// Data Migration & Retrieval
function getPresetData() {
    try {
        const raw = localStorage.getItem(PRESET_STORAGE_KEY);
        if (!raw) return {};

        const data = JSON.parse(raw);

        // Check for migration: If any key's value has 'metronomes' property directly, it's flat.
        // Or if it's empty, return empty object.
        const keys = Object.keys(data);
        if (keys.length > 0) {
            const firstKey = keys[0];
            // Duck typing: check if the first item looks like a preset (has metronomes array)
            // or if the data structure is the old flat format
            if (data[firstKey] && data[firstKey].metronomes) {
                console.log('Migrating presets to folder structure...');
                const migrated = {
                    'デフォルト': data
                };
                savePresetData(migrated);
                return migrated;
            }
        }

        return data;
    } catch (e) {
        console.error('Failed to load presets:', e);
        return {};
    }
}

function savePresetData(data) {
    try {
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        console.error('Failed to save presets:', e);
        return false;
    }
}

// Extract current state from a metronome
function extractMetronomeState(metronome) {
    return {
        tempo: metronome.tempo,
        currentPattern: metronome.currentPattern,
        clickMultiplier: metronome.clickMultiplier,
        offbeatMultiplier: metronome.offbeatMultiplier,
        accentEnabled: metronome.accentEnabled,
        volume: metronome.volume,
        offbeatVolume: metronome.offbeatVolume,
        pitch: metronome.pitch,
        isOffbeat: metronome.isOffbeat,
        visualMode: metronome.visualMode
    };
}

// Apply state to a metronome and update its UI
function applyMetronomeState(metronome, state) {
    const el = metronome.element;

    // Tempo
    metronome.tempo = state.tempo || 120;
    el.querySelector('.tempo-input').value = metronome.tempo;
    el.querySelector('.tempo-slider').value = metronome.tempo;

    // Pattern
    metronome.currentPattern = state.currentPattern || 'quarter';
    const rhythmBtns = el.querySelectorAll('.rhythm-btn');
    rhythmBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pattern === metronome.currentPattern);
    });
    metronome.updateBeatDots();

    // Click Multiplier
    metronome.clickMultiplier = state.clickMultiplier || 1;
    const multBtns = el.querySelectorAll('.multiplier-btn');
    multBtns.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.multiplier) === metronome.clickMultiplier);
    });

    // Offbeat Multiplier
    metronome.offbeatMultiplier = state.offbeatMultiplier || 1;
    const offMultBtns = el.querySelectorAll('.offbeat-mult-btn');
    offMultBtns.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.multiplier) === metronome.offbeatMultiplier);
    });

    // Volume
    metronome.volume = state.volume !== undefined ? state.volume : 1.0;
    const volVal = Math.round(metronome.volume * 100);
    el.querySelector('.volume-slider').value = volVal;
    el.querySelector('.volume-display').textContent = volVal + '%';
    const muteBtn = el.querySelector('.main-mute-btn');
    muteBtn.textContent = metronome.volume === 0 ? '🔇' : '🔈';
    muteBtn.classList.toggle('muted', metronome.volume === 0);

    // Offbeat Volume
    metronome.offbeatVolume = state.offbeatVolume !== undefined ? state.offbeatVolume : 0;
    const offVolVal = Math.round(metronome.offbeatVolume * 100);
    el.querySelector('.offbeat-volume-slider').value = offVolVal;
    el.querySelector('.offbeat-volume-display').textContent = offVolVal + '%';
    const offMuteBtn = el.querySelector('.offbeat-mute-btn');
    offMuteBtn.textContent = metronome.offbeatVolume === 0 ? '🔇' : '🔈';
    offMuteBtn.classList.toggle('muted', metronome.offbeatVolume === 0);

    // Pitch
    metronome.pitch = state.pitch || 800;
    const pitchSlider = el.querySelector('.pitch-slider');
    const pitchDisplay = el.querySelector('.pitch-display');
    if (pitchSlider && pitchDisplay) {
        pitchSlider.value = metronome.pitch;
        pitchDisplay.textContent = metronome.pitch + 'Hz';
    }

    // Accent
    metronome.accentEnabled = state.accentEnabled !== undefined ? state.accentEnabled : true;
    el.querySelector('.accent-toggle').classList.toggle('active', metronome.accentEnabled);

    // Offbeat toggle
    metronome.isOffbeat = state.isOffbeat || false;
    el.querySelector('.offbeat-toggle').classList.toggle('offbeat', metronome.isOffbeat);

    // Visual Mode
    metronome.visualMode = state.visualMode || 'main'; // Default to main
    const visToggle = el.querySelector('.visual-mode-toggle');
    const visValue = el.querySelector('.visual-mode-value');
    const visLabel = el.querySelector('.visual-mode-label');

    if (visToggle) {
        visToggle.dataset.mode = metronome.visualMode;

        const textMap = {
            'main': '表拍のみ',
            'offbeat': '裏拍のみ',
            'both': '両拍'
        };

        if (visValue) {
            visValue.textContent = textMap[metronome.visualMode];
        } else if (visLabel) {
            visLabel.textContent = `表示設定: ${textMap[metronome.visualMode]}`;
        }
    }

    metronome.updateBeatDots();
}

// UI Refreshers
function refreshFolderSelects() {
    const data = getPresetData();
    const folderNames = Object.keys(data).sort((a, b) => a.localeCompare(b, 'ja'));

    // 1. Main Folder Select
    const currentMainFolder = folderSelect.value;
    folderSelect.innerHTML = '<option value="">-- フォルダを選択 --</option>';
    folderNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        folderSelect.appendChild(opt);
    });
    if (folderNames.includes(currentMainFolder)) folderSelect.value = currentMainFolder;

    // 2. Save Folder Select
    const currentSaveFolder = saveFolderSelect.value;
    // Keep the first "New Folder" option
    while (saveFolderSelect.options.length > 1) {
        saveFolderSelect.remove(1);
    }
    folderNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        saveFolderSelect.appendChild(opt);
    });

    // Restore or default
    if (folderNames.includes(currentSaveFolder)) {
        saveFolderSelect.value = currentSaveFolder;
    } else if (folderNames.length > 0 && currentSaveFolder !== 'new') {
        saveFolderSelect.value = folderNames[0]; // Default to first existing folder if not new
    }

    // Trigger UI updates
    toggleNewFolderInput();
    refreshPresetSelect();
}

function refreshPresetSelect() {
    const folderName = folderSelect.value;
    presetSelect.innerHTML = '<option value="">-- プリセットを選択 --</option>';

    if (!folderName) {
        updatePresetButtonStates();
        return;
    }

    const data = getPresetData();
    const folder = data[folderName];

    if (folder) {
        const presets = Object.keys(folder).sort((a, b) => a.localeCompare(b, 'ja'));
        presets.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            presetSelect.appendChild(opt);
        });
    }
    updatePresetButtonStates();
}

function toggleNewFolderInput() {
    if (saveFolderSelect.value === 'new') {
        newFolderInput.classList.add('show');
        newFolderInput.focus();
    } else {
        newFolderInput.classList.remove('show');
    }
}

function updatePresetButtonStates() {
    const hasSelection = presetSelect.value !== '';
    loadPresetBtn.disabled = !hasSelection;
    deletePresetBtn.disabled = !hasSelection;
}


// SAVE Logic
function savePreset() {
    const presetName = presetNameInput.value.trim();
    if (!presetName) {
        showToast('プリセット名を入力してください', 'error');
        presetNameInput.focus();
        return;
    }

    let folderName = saveFolderSelect.value;
    if (folderName === 'new') {
        folderName = newFolderInput.value.trim();
        if (!folderName) {
            showToast('新規フォルダ名を入力してください', 'error');
            newFolderInput.focus();
            return;
        }
    }

    if (metronomes.length === 0) {
        showToast('保存するメトロノームがありません', 'error');
        return;
    }

    const data = getPresetData();

    // Create folder if not exists
    if (!data[folderName]) {
        data[folderName] = {};
    }

    const isOverwrite = data[folderName].hasOwnProperty(presetName);

    // Save Preset
    data[folderName][presetName] = {
        createdAt: isOverwrite ? data[folderName][presetName].createdAt : Date.now(),
        updatedAt: Date.now(),
        metronomes: metronomes.map(m => extractMetronomeState(m))
    };

    if (savePresetData(data)) {
        showToast(isOverwrite ? `「${folderName} / ${presetName}」を上書き保存しました` : `「${folderName} / ${presetName}」を保存しました`, 'success');
        presetNameInput.value = '';
        if (saveFolderSelect.value === 'new') {
            newFolderInput.value = '';
        }

        // Refresh UIs
        refreshFolderSelects();

        // Auto-select the saved one
        folderSelect.value = folderName;
        refreshPresetSelect();
        presetSelect.value = presetName;
        updatePresetButtonStates();
    } else {
        showToast('保存に失敗しました', 'error');
    }
}

// LOAD Logic
function loadPreset() {
    const folderName = folderSelect.value;
    const presetName = presetSelect.value;

    if (!folderName || !presetName) {
        showToast('読み込むプリセットを選択してください', 'info');
        return;
    }

    const data = getPresetData();
    const folder = data[folderName];
    const preset = folder ? folder[presetName] : null;

    if (!preset) {
        showToast('プリセットが見つかりません', 'error');
        return;
    }

    // Stop all playing metronomes
    metronomes.forEach(m => {
        if (m.isPlaying) m.toggle();
    });

    // Clear existing metronomes
    while (metronomes.length > 0) {
        metronomes[0].remove();
    }

    // Create metronomes from preset
    preset.metronomes.forEach(state => {
        const m = new Metronome(Date.now() + Math.random());
        metronomes.push(m);
        applyMetronomeState(m, state);
    });

    showToast(`「${presetName}」を読み込みました`, 'success');
}

// DELETE Logic
function deletePreset() {
    const folderName = folderSelect.value;
    const presetName = presetSelect.value;

    if (!folderName || !presetName) {
        return;
    }

    if (!confirm(`フォルダ「${folderName}」のプリセット「${presetName}」を削除しますか？`)) {
        return;
    }

    const data = getPresetData();
    if (data[folderName] && data[folderName][presetName]) {
        delete data[folderName][presetName];

        // Optional: Remove empty folders?
        // Let's keep them for now as per plan, unless explicitly empty.
        // If user wants to delete folder, maybe we need a separate "Delete Folder" button?
        // For now, if folder is empty, maybe we clean it up to keep it clean.
        // Actually, let's keep it simple: If folder is empty, delete it.
        if (Object.keys(data[folderName]).length === 0) {
            delete data[folderName];
            showToast(`フォルダ「${folderName}」も空になったため削除しました`, 'info');
        }

        savePresetData(data);
        showToast(`「${presetName}」を削除しました`, 'success');

        refreshFolderSelects();
        refreshPresetSelect();
    }
}


// Event Listeners
savePresetBtn.addEventListener('click', savePreset);
loadPresetBtn.addEventListener('click', loadPreset);
deletePresetBtn.addEventListener('click', deletePreset);

folderSelect.addEventListener('change', () => {
    refreshPresetSelect();
});

presetSelect.addEventListener('change', updatePresetButtonStates);

saveFolderSelect.addEventListener('change', toggleNewFolderInput);

// Enter key support
presetNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') savePreset();
});
newFolderInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') savePreset();
});


// Initialize
refreshFolderSelects();

