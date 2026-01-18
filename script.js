// Audio Context
let audioContext = null;
let isPlaying = false;
let tempo = 120;
let currentPattern = 'quarter';
let currentBeat = 0;
let isOffbeat = false;
let schedulerTimer = null;
let nextNoteTime = 0;
let scheduleAheadTime = 0.1;
let lookahead = 25;

// DOM Elements
const playBtn = document.getElementById('play-btn');
const tempoSlider = document.getElementById('tempo-slider');
const tempoValue = document.getElementById('tempo-value');
const tempoDown = document.getElementById('tempo-down');
const tempoUp = document.getElementById('tempo-up');
const rhythmBtns = document.querySelectorAll('.rhythm-btn');
const beatDots = document.getElementById('beat-dots');
const offbeatToggle = document.getElementById('offbeat-toggle');

// Pattern Definitions
const patterns = {
    'quarter': {
        beats: 4,
        subdivisions: 1,
        notes: [1, 1, 1, 1] // All beats sound
    },
    'triplet': {
        beats: 3,
        subdivisions: 1,
        notes: [1, 1, 1] // All triplet notes sound
    },
    'triplet-hollow': {
        beats: 3,
        subdivisions: 1,
        notes: [1, 0, 1] // First and third sound, middle is silent
    }
};

// Initialize
function init() {
    updateTempoDisplay();
    updateBeatDots();
    setupEventListeners();
}

// Setup Event Listeners
function setupEventListeners() {
    playBtn.addEventListener('click', togglePlay);

    tempoSlider.addEventListener('input', (e) => {
        tempo = parseInt(e.target.value);
        updateTempoDisplay();
    });

    tempoDown.addEventListener('click', () => {
        tempo = Math.max(40, tempo - 5);
        tempoSlider.value = tempo;
        updateTempoDisplay();
    });

    tempoUp.addEventListener('click', () => {
        tempo = Math.min(240, tempo + 5);
        tempoSlider.value = tempo;
        updateTempoDisplay();
    });

    rhythmBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rhythmBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPattern = btn.dataset.pattern;
            currentBeat = 0;
            updateBeatDots();
        });
    });

    offbeatToggle.addEventListener('click', () => {
        isOffbeat = !isOffbeat;
        offbeatToggle.classList.toggle('offbeat', isOffbeat);
    });
}

// Update Tempo Display
function updateTempoDisplay() {
    tempoValue.textContent = tempo;
}

// Update Beat Dots
function updateBeatDots() {
    const pattern = patterns[currentPattern];
    beatDots.innerHTML = '';

    for (let i = 0; i < pattern.beats; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        if (pattern.notes[i] === 0) {
            dot.style.opacity = '0.3';
        }
        beatDots.appendChild(dot);
    }
}

// Toggle Play/Stop
function togglePlay() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (isPlaying) {
        stop();
    } else {
        start();
    }
}

// Start Metronome
function start() {
    isPlaying = true;
    currentBeat = 0;
    nextNoteTime = audioContext.currentTime;

    playBtn.classList.add('playing');
    playBtn.querySelector('.play-icon').textContent = '⏹';
    playBtn.querySelector('.btn-text').textContent = 'ストップ';

    scheduler();
}

// Stop Metronome
function stop() {
    isPlaying = false;
    clearTimeout(schedulerTimer);

    playBtn.classList.remove('playing');
    playBtn.querySelector('.play-icon').textContent = '▶';
    playBtn.querySelector('.btn-text').textContent = 'スタート';

    // Clear active dots
    document.querySelectorAll('.beat-dots .dot').forEach(dot => {
        dot.classList.remove('active', 'first');
    });
}

// Scheduler
function scheduler() {
    while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
        scheduleNote(currentBeat, nextNoteTime);
        nextNote();
    }
    schedulerTimer = setTimeout(scheduler, lookahead);
}

// Schedule Note
function scheduleNote(beatNumber, time) {
    const pattern = patterns[currentPattern];

    // Calculate offbeat delay
    let offbeatDelay = 0;
    if (isOffbeat) {
        if (currentPattern === 'quarter') {
            offbeatDelay = (60.0 / tempo) / 2; // Half a beat
        } else {
            offbeatDelay = (60.0 / tempo / 3) / 2; // Half a triplet note
        }
    }

    // Visual feedback
    setTimeout(() => {
        if (!isPlaying) return;

        const dots = document.querySelectorAll('.beat-dots .dot');
        dots.forEach((dot, i) => {
            dot.classList.remove('active', 'first');
            if (i === beatNumber) {
                dot.classList.add('active');
                if (i === 0) {
                    dot.classList.add('first');
                }
            }
        });
    }, (time - audioContext.currentTime) * 1000);

    // Check if this beat should sound
    if (pattern.notes[beatNumber] === 0) {
        return; // Silent beat
    }

    // Actual sound time (with offbeat delay)
    const soundTime = time + offbeatDelay;

    // Create oscillator for click sound
    const osc = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // First beat is higher pitch
    if (beatNumber === 0) {
        osc.frequency.value = 1000;
        gainNode.gain.value = 0.5;
    } else {
        osc.frequency.value = 800;
        gainNode.gain.value = 0.3;
    }

    osc.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Short click sound
    osc.start(soundTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, soundTime + 0.05);
    osc.stop(soundTime + 0.05);
}

// Next Note
function nextNote() {
    const pattern = patterns[currentPattern];

    // Calculate note duration based on pattern
    let noteDuration;
    if (currentPattern === 'quarter') {
        // Quarter notes: seconds per beat
        noteDuration = 60.0 / tempo;
    } else {
        // Triplets: 3 notes per beat, so each note is 1/3 of a beat
        noteDuration = 60.0 / tempo / 3;
    }

    nextNoteTime += noteDuration;
    currentBeat = (currentBeat + 1) % pattern.beats;
}

// Initialize on page load
init();
