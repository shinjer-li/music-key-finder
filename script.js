/* ─────────────────────────────────────────
   KeyFinder — script.js
   Web Audio API + Chromagram-based key detection
───────────────────────────────────────── */

// ── Music Theory Data ──────────────────────────────────────────────────────

const NOTE_NAMES = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

// Circle of fifths order (for display)
const CIRCLE_MAJOR = ['C','G','D','A','E','B','F♯','D♭','A♭','E♭','B♭','F'];
const CIRCLE_MINOR = ['A','E','B','F♯','C♯','G♯','E♭','B♭','F','C','G','D'];

// Notes in each major/minor scale
const SCALE_NOTES = {
  major: [0,2,4,5,7,9,11],
  minor: [0,2,3,5,7,8,10]
};

// ── State ─────────────────────────────────────────────────────────────────

let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let timerInterval = null;
let elapsed = 0;
let isRecording = false;
let audioBuffer = null;     // decoded AudioBuffer
let animFrameId = null;
let analyserNode = null;

// ── DOM Refs ───────────────────────────────────────────────────────────────

const recordBtn    = document.getElementById('recordBtn');
const recordIcon   = document.getElementById('recordIcon');
const recordLabel  = document.getElementById('recordLabel');
const analyzeBtn   = document.getElementById('analyzeBtn');
const resetBtn     = document.getElementById('resetBtn');
const timerEl      = document.getElementById('timer');
const barsEl       = document.getElementById('bars');
const idlePrompt   = document.getElementById('idle-prompt');
const fileInput    = document.getElementById('fileInput');
const uploadZone   = document.getElementById('uploadZone');

const resultIdle   = document.getElementById('resultIdle');
const resultLoad   = document.getElementById('resultLoading');
const resultOutput = document.getElementById('resultOutput');
const resultError  = document.getElementById('resultError');
const errorMsg     = document.getElementById('errorMsg');

const keyMainEl    = document.getElementById('keyMain');
const keyModeEl    = document.getElementById('keyMode');
const relKeyEl     = document.getElementById('relativeKey');
const keyNotesEl   = document.getElementById('keyNotes');
const confidenceEl = document.getElementById('confidence');
const canvas       = document.getElementById('circleCanvas');

// ── Build waveform bars ────────────────────────────────────────────────────

const BAR_COUNT = 48;
for (let i = 0; i < BAR_COUNT; i++) {
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.style.height = '3px';
  barsEl.appendChild(bar);
}
const bars = Array.from(barsEl.querySelectorAll('.bar'));

// ── Timer helpers ──────────────────────────────────────────────────────────

function startTimer() {
  elapsed = 0;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    elapsed++;
    updateTimerDisplay();
    if (elapsed >= 20) stopRecording();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimerDisplay() {
  const s = elapsed % 60;
  timerEl.innerHTML = `0:${String(s).padStart(2,'0')} <span class="timer-max">/ 0:20</span>`;
}

// ── Waveform animation ─────────────────────────────────────────────────────

function startWaveformAnimation(analyser) {
  const dataArr = new Uint8Array(analyser.frequencyBinCount);
  function draw() {
    animFrameId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArr);
    const step = Math.floor(dataArr.length / BAR_COUNT);
    bars.forEach((bar, i) => {
      const val = dataArr[i * step] / 255;
      const h = Math.max(3, val * 56);
      bar.style.height = h + 'px';
      bar.style.opacity = 0.5 + val * 0.5;
    });
  }
  draw();
}

function stopWaveformAnimation() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

function resetBars() {
  bars.forEach(b => { b.style.height = '3px'; b.style.opacity = '0.85'; });
}

// Draw static waveform from audio buffer
function drawBufferWaveform(buffer) {
  const data = buffer.getChannelData(0);
  const step = Math.floor(data.length / BAR_COUNT);
  bars.forEach((bar, i) => {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += Math.abs(data[i * step + j] || 0);
    const rms = sum / step;
    const h = Math.max(3, rms * 220);
    bar.style.height = Math.min(h, 56) + 'px';
    bar.style.opacity = '0.85';
  });
}

// ── Recording ─────────────────────────────────────────────────────────────

recordBtn.addEventListener('click', () => {
  if (isRecording) { stopRecording(); }
  else             { startRecording(); }
});

async function startRecording() {
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    showError('Microphone access denied. Please allow mic access and try again.');
    return;
  }

  // Set up analyser for live waveform
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(recordingStream);
  analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 256;
  src.connect(analyserNode);

  audioChunks = [];
  mediaRecorder = new MediaRecorder(recordingStream);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop = () => { ctx.close(); onRecordingComplete(); };
  mediaRecorder.start();

  isRecording = true;
  idlePrompt.classList.add('hidden');
  recordBtn.classList.add('recording');
  recordIcon.textContent = '■';
  recordLabel.textContent = 'Stop';
  analyzeBtn.disabled = true;
  resetBtn.disabled = true;

  startTimer();
  startWaveformAnimation(analyserNode);
//   showResultIdle();
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
  recordingStream.getTracks().forEach(t => t.stop());
  isRecording = false;
  stopTimer();
  stopWaveformAnimation();

  recordBtn.classList.remove('recording');
  recordIcon.textContent = '●';
  recordLabel.textContent = 'Record';
}

async function onRecordingComplete() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  await decodeBlob(blob);
}

// ── File Upload ────────────────────────────────────────────────────────────

fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  if (!file.type.startsWith('audio/')) {
    showError('Please upload an audio file (MP3, WAV, OGG, etc.)');
    return;
  }
  resetUI();
  await decodeBlob(file);
}

// ── Decode audio blob → AudioBuffer ───────────────────────────────────────

async function decodeBlob(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new AudioContext();
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    await ctx.close();

    // Trim to 20s
    if (audioBuffer.duration > 20) {
      audioBuffer = trimBuffer(audioBuffer, 20);
    }

    drawBufferWaveform(audioBuffer);
    analyzeBtn.disabled = false;
    resetBtn.disabled = false;
    idlePrompt.classList.add('hidden');

    // Update timer to show duration
    const dur = Math.round(audioBuffer.duration);
    const s = dur % 60;
    timerEl.innerHTML = `0:${String(s).padStart(2,'0')} <span class="timer-max">/ 0:20</span>`;
  } catch (e) {
    showError('Could not decode audio. Please try a different file.');
  }
}

function trimBuffer(buffer, maxSec) {
  const sampleRate = buffer.sampleRate;
  const maxSamples = maxSec * sampleRate;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, maxSamples, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  // Return the original — trimming happens during chromagram analysis window
  return buffer;
}

// ── Analyze ───────────────────────────────────────────────────────────────

analyzeBtn.addEventListener('click', () => {
  if (!audioBuffer) return;
  runAnalysis();
});

async function runAnalysis() {
  showResultLoading();
  analyzeBtn.disabled = true;

  // Small delay so UI updates before heavy computation
  await sleep(80);

  try {
    const chroma = computeChromagram(audioBuffer);
    const result = detectKey(chroma);
    displayResult(result);
  } catch(e) {
    showError('Analysis failed. Try recording again or uploading a different file.');
    analyzeBtn.disabled = false;
  }
}

// ── Chromagram ─────────────────────────────────────────────────────────────

function computeChromagram(buffer) {
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const maxSamples = Math.min(samples.length, sampleRate * 20);

  // FFT size — larger = better frequency resolution
  const fftSize = 8192;
  const hopSize = fftSize / 2;
  const chroma = new Float32Array(12).fill(0);

  // Hann window
  const window = hannWindow(fftSize);

  let frameCount = 0;
  for (let start = 0; start + fftSize <= maxSamples; start += hopSize) {
    const frame = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      frame[i] = (samples[start + i] || 0) * window[i];
    }

    const spectrum = realFFT(frame);
    accumulateChroma(spectrum, sampleRate, fftSize, chroma);
    frameCount++;
  }

  // Normalize
  const max = Math.max(...chroma);
  return max > 0 ? chroma.map(v => v / max) : chroma;
}

function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

// Simple DFT-based magnitude spectrum (returns magnitude array of length fftSize/2)
function realFFT(frame) {
  const N = frame.length;
  const half = N / 2;
  const mag = new Float32Array(half);

  // Use Web Audio OfflineAudioContext trick via a pre-computed approach
  // We'll use a direct DFT for the pitch-relevant range only (A1=55Hz to C8=4186Hz)
  // This avoids shipping a full FFT library while being fast enough for 20s audio

  const step = Math.max(1, Math.floor(N / 2048)); // subsample for speed
  for (let k = 0; k < half; k += step) {
    let re = 0, im = 0;
    // Goertzel-style inner loop
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += frame[n] * Math.cos(angle);
      im -= frame[n] * Math.sin(angle);
    }
    const m = Math.sqrt(re * re + im * im);
    for (let s = 0; s < step && k + s < half; s++) mag[k + s] = m;
  }
  return mag;
}

function accumulateChroma(spectrum, sampleRate, fftSize, chroma) {
  const binHz = sampleRate / fftSize;
  const A4 = 440;
  const C0_freq = A4 * Math.pow(2, -4.75); // ~16.35 Hz

  for (let k = 1; k < spectrum.length; k++) {
    const freq = k * binHz;
    if (freq < 27.5 || freq > 4200) continue; // A0 to ~C8
    if (spectrum[k] < 0.001) continue;

    // Map frequency to pitch class
    const midi = 12 * Math.log2(freq / C0_freq);
    const pitchClass = Math.round(midi) % 12;
    const pc = ((pitchClass % 12) + 12) % 12;
    chroma[pc] += spectrum[k];
  }
}

// ── Key Detection (Krumhansl-Schmuckler) ──────────────────────────────────

function detectKey(chroma) {
  let bestScore = -Infinity;
  let bestKey = 0;
  let bestMode = 'major';

  const scores = [];

  for (let root = 0; root < 12; root++) {
    const majorScore = correlation(chroma, rotate(MAJOR_PROFILE, root));
    const minorScore = correlation(chroma, rotate(MINOR_PROFILE, root));

    scores.push({ root, mode: 'major', score: majorScore });
    scores.push({ root, mode: 'minor', score: minorScore });

    if (majorScore > bestScore) { bestScore = majorScore; bestKey = root; bestMode = 'major'; }
    if (minorScore > bestScore) { bestScore = minorScore; bestKey = root; bestMode = 'minor'; }
  }

  // Confidence = gap between best and second-best
  scores.sort((a, b) => b.score - a.score);
  const gap = scores[0].score - scores[1].score;
  const confidence = Math.min(100, Math.round((gap / scores[0].score) * 400));

  // Build scale notes string
  const intervals = SCALE_NOTES[bestMode];
  const noteList = intervals.map(i => NOTE_NAMES[(bestKey + i) % 12]).join(' · ');

  // Relative key
  let relRoot;
  if (bestMode === 'major') {
    relRoot = (bestKey + 9) % 12;  // relative minor is 6th degree
  } else {
    relRoot = (bestKey + 3) % 12;  // relative major is 3rd degree
  }
  const relMode = bestMode === 'major' ? 'minor' : 'major';
  const relativeName = `${NOTE_NAMES[relRoot]} ${relMode}`;

  return {
    root: bestKey,
    rootName: NOTE_NAMES[bestKey],
    mode: bestMode,
    noteList,
    relativeName,
    confidence: confidence + '%',
    chroma
  };
}

function rotate(arr, n) {
  const out = new Array(12);
  for (let i = 0; i < 12; i++) out[i] = arr[(i - n + 12) % 12];
  return out;
}

function correlation(a, b) {
  const n = a.length;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA  += a[i];
    sumB  += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  return den === 0 ? 0 : num / den;
}

// ── Circle of Fifths Canvas ────────────────────────────────────────────────

function drawCircleOfFifths(rootName, mode) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const outerR = 82, innerR = 52, labelR = 68, innerLabelR = 42;

  ctx.clearRect(0, 0, W, H);

  const keys = mode === 'major' ? CIRCLE_MAJOR : CIRCLE_MINOR;
  const oppKeys = mode === 'major' ? CIRCLE_MINOR : CIRCLE_MAJOR;
  const total = 12;

  for (let i = 0; i < total; i++) {
    const startAngle = (i / total) * Math.PI * 2 - Math.PI / 2 - Math.PI / total;
    const endAngle   = startAngle + (Math.PI * 2) / total;
    const midAngle   = (startAngle + endAngle) / 2;

    const isActive = keys[i] === rootName || (mode === 'minor' && keys[i] === rootName);

    // Outer wedge
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = isActive ? 'rgba(201,168,76,0.25)' : 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner wedge (relative)
    const relNote = oppKeys[i];
    const isRelActive = relNote === rootName;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, innerR, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = isRelActive ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.02)';
    ctx.fill();
    ctx.strokeStyle = '#2a2a2a';
    ctx.stroke();

    // Outer label
    const lx = cx + Math.cos(midAngle) * labelR;
    const ly = cy + Math.sin(midAngle) * labelR;
    ctx.font = isActive ? 'bold 11px DM Mono, monospace' : '10px DM Mono, monospace';
    ctx.fillStyle = isActive ? '#c9a84c' : '#666';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(keys[i], lx, ly);

    // Inner label
    const ilx = cx + Math.cos(midAngle) * innerLabelR;
    const ily = cy + Math.sin(midAngle) * innerLabelR;
    ctx.font = '8px DM Mono, monospace';
    ctx.fillStyle = isRelActive ? '#8a6f30' : '#444';
    ctx.fillText(oppKeys[i], ilx, ily);
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#c9a84c';
  ctx.fill();
}

// ── UI State ──────────────────────────────────────────────────────────────

function showResultIdle() {
  resultIdle.hidden   = false;
  resultLoad.hidden   = true;
  resultOutput.hidden = true;
  resultError.hidden  = true;
}

function showResultLoading() {
  resultIdle.hidden   = true;
  resultLoad.hidden   = false;
  resultOutput.hidden = true;
  resultError.hidden  = true;
}

function displayResult(result) {
  resultIdle.hidden   = true;
  resultLoad.hidden   = true;
  resultOutput.hidden = false;
  resultError.hidden  = true;

  // Force re-animation
  keyMainEl.style.animation = 'none';
  keyMainEl.offsetHeight;
  keyMainEl.style.animation = '';

  keyMainEl.textContent = result.rootName;
  keyModeEl.textContent = result.mode.toUpperCase();
  relKeyEl.textContent  = result.relativeName;
  keyNotesEl.textContent = result.noteList;
  confidenceEl.textContent = result.confidence;

  drawCircleOfFifths(result.rootName, result.mode);

  analyzeBtn.disabled = false;
}

function showError(msg) {
  resultIdle.hidden   = true;
  resultLoad.hidden   = true;
  resultOutput.hidden = true;
  resultError.hidden  = false;
  errorMsg.textContent = msg;
}

function resetUI() {
  stopRecording();
  stopWaveformAnimation();
  stopTimer();
  audioBuffer = null;
  audioChunks = [];
  elapsed = 0;
  updateTimerDisplay();
  resetBars();
  idlePrompt.classList.remove('hidden');
  analyzeBtn.disabled = true;
  resetBtn.disabled = true;
  showResultIdle();
}

resetBtn.addEventListener('click', resetUI);

// ── Utilities ─────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }