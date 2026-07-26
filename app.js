const $ = id => document.getElementById(id);

const state = {
  cvText: '',
  jdText: '',
  profile: null,
  blueprint: null,
  currentQuestion: null,
  questionNumber: 0,
  policy: null,
  coverage: null,
  answers: [],
  report: null,
  micStream: null,
  mediaRecorder: null,
  chunks: [],
  audioContext: null,
  analyser: null,
  analyserData: null,
  silenceTimer: null,
  answerStartedAt: 0,
  lastSpeechAt: 0,
  hasSpeech: false,
  discardRecording: false,
  questionAudioUrl: null,
  timerStartedAt: 0,
  timerHandle: null,
  toastHandle: null
};

const screens = ['setupScreen', 'interviewScreen', 'reportScreen'];
const SILENCE_MS = 2300;
const NO_SPEECH_TIMEOUT_MS = 14000;
const MAX_ANSWER_MS = 120000;
const SPEECH_THRESHOLD = 0.022;

function showScreen(id) {
  screens.forEach(screen => $(screen).classList.toggle('active', screen === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setBusy(on, text = 'Preparing...') {
  $('processingText').textContent = text;
  $('processingOverlay').classList.toggle('hidden', !on);
}

function showToast(message, timeout = 3500) {
  clearTimeout(state.toastHandle);
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  state.toastHandle = setTimeout(() => $('toast').classList.add('hidden'), timeout);
}

function configuredPolicy() {
  return {
    minQuestions: Number(window.APP_CONFIG?.MIN_QUESTIONS || 8),
    targetQuestions: Number(window.APP_CONFIG?.TARGET_QUESTIONS || 12),
    maxQuestions: Number(window.APP_CONFIG?.MAX_QUESTIONS || 16)
  };
}

async function callApi(action, payload = {}) {
  const url = window.APP_CONFIG?.API_URL;
  if (!url) throw new Error('Backend URL has not been added to config.js.');

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      body: JSON.stringify({ action, ...payload })
    });
  } catch (_) {
    throw new Error('Could not reach the interview backend. Confirm the Apps Script deployment is available to anyone.');
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error('The backend returned an invalid response. Deploy the latest backend/Code.gs as a new Apps Script version.');
  }
  if (!data.ok) throw new Error(data.error || 'Backend request failed.');
  return data.data;
}

async function extractFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt') return file.text();
  if (extension === 'docx') {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (extension === 'pdf') {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
  }
  throw new Error('Use a PDF, DOCX or TXT file.');
}

function validateSetup() {
  state.jdText = $('jdText').value.trim() || state.jdText;
  const ready = state.cvText.trim().length > 80 && state.jdText.trim().length > 80;
  $('startButton').disabled = !ready;
  $('setupMessage').textContent = ready ? 'Ready when you are.' : 'Add both documents to continue.';
}

async function bindFile(inputId, nameId, target) {
  const file = $(inputId).files[0];
  if (!file) return;
  try {
    $(nameId).textContent = 'Reading file...';
    state[target] = await extractFile(file);
    $(nameId).textContent = file.name;
    if (target === 'jdText') $('jdText').value = state.jdText;
    validateSetup();
  } catch (error) {
    $(nameId).textContent = error.message;
  }
}

$('cvButton').onclick = () => $('cvFile').click();
$('jdButton').onclick = () => $('jdFile').click();
$('cvFile').onchange = () => bindFile('cvFile', 'cvName', 'cvText');
$('jdFile').onchange = () => bindFile('jdFile', 'jdName', 'jdText');
$('jdText').oninput = validateSetup;

async function initialise() {
  try {
    const result = await callApi('health');
    $('connectionStatus').textContent = `Connected · ${result.version || 'ready'}`;
  } catch (error) {
    $('connectionStatus').textContent = 'Backend unavailable';
    console.error(error);
  }
}

async function ensureMicrophone() {
  if (state.micStream?.active) return state.micStream;
  state.micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
  });

  state.audioContext = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
  await state.audioContext.resume();
  const source = state.audioContext.createMediaStreamSource(state.micStream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  state.analyser.smoothingTimeConstant = .45;
  state.analyserData = new Float32Array(state.analyser.fftSize);
  source.connect(state.analyser);
  return state.micStream;
}

$('startButton').onclick = async () => {
  try {
    state.jdText = $('jdText').value.trim();
    state.policy = configuredPolicy();
    await ensureMicrophone();
    setBusy(true, 'Building your interview...');

    const result = await callApi('prepareInterview', {
      cvText: state.cvText,
      jdText: state.jdText,
      ...state.policy
    });

    state.profile = result.profile;
    state.blueprint = result.blueprint;
    state.currentQuestion = result.firstQuestion;
    state.policy = result.policy || state.policy;
    state.questionNumber = 1;
    state.coverage = null;
    state.answers = [];
    startSessionTimer();
    showScreen('interviewScreen');
    setBusy(false);
    await presentQuestion();
  } catch (error) {
    setBusy(false);
    alert(error.message);
  }
};

function startSessionTimer() {
  state.timerStartedAt = Date.now();
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    const total = Math.floor((Date.now() - state.timerStartedAt) / 1000);
    $('timer').textContent = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }, 1000);
}

function updateProgress() {
  const max = state.policy?.maxQuestions || 16;
  const progress = Math.min(1, Math.max(0, state.questionNumber / max));
  $('progressArc').style.strokeDashoffset = String(634.6 * (1 - progress));
}

function setStage(mode, status) {
  $('voiceOrb').className = `voice-orb ${mode}`;
  $('stageStatus').textContent = status;
}

async function presentQuestion() {
  if (!state.currentQuestion) return finishInterview();
  updateProgress();
  $('questionCounter').textContent = `Question ${state.questionNumber}`;
  $('questionText').textContent = state.currentQuestion.question;
  $('repeatQuestionButton').disabled = true;
  $('doneAnswerButton').disabled = true;
  $('endEarlyButton').disabled = state.answers.length < 5;
  await speakQuestion(state.currentQuestion.question);
}

async function speakQuestion(text) {
  cancelListening(true);
  setStage('speaking', 'Listen to the question.');
  $('repeatQuestionButton').disabled = true;
  $('doneAnswerButton').disabled = true;

  try {
    const result = await callApi('synthesiseSpeech', { text });
    await playPcmAudio(result.audioBase64, Number(result.sampleRate || 24000));
  } catch (error) {
    console.warn('Gemini TTS unavailable, using browser voice.', error);
    await speakWithBrowserVoice(text);
  }

  await wait(320);
  await startListening();
}

function playPcmAudio(base64, sampleRate) {
  return new Promise((resolve, reject) => {
    if (!base64) return reject(new Error('No TTS audio returned.'));
    if (state.questionAudioUrl) URL.revokeObjectURL(state.questionAudioUrl);
    const bytes = base64ToBytes(base64);
    const wav = pcmToWavBlob(bytes, sampleRate, 1, 16);
    state.questionAudioUrl = URL.createObjectURL(wav);
    const audio = $('questionAudio');
    audio.src = state.questionAudioUrl;
    audio.onended = resolve;
    audio.onerror = () => reject(new Error('Generated voice could not be played.'));
    audio.play().catch(reject);
  });
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pcmToWavBlob(pcmBytes, sampleRate, channels, bitsPerSample) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bitsPerSample / 8, true);
  view.setUint16(32, channels * bitsPerSample / 8, true);
  view.setUint16(34, bitsPerSample, true);
  write(36, 'data');
  view.setUint32(40, pcmBytes.length, true);
  return new Blob([header, pcmBytes], { type: 'audio/wav' });
}

function speakWithBrowserVoice(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const preferred = [
      'Microsoft Sonia Online', 'Microsoft Libby Online', 'Microsoft Ryan Online',
      'Microsoft Aria Online', 'Google UK English Female', 'Google UK English Male'
    ];
    utterance.voice = preferred.map(name => voices.find(voice => voice.name.includes(name))).find(Boolean)
      || voices.find(voice => /^en-GB/i.test(voice.lang))
      || voices.find(voice => /^en/i.test(voice.lang))
      || null;
    utterance.lang = 'en-GB';
    utterance.rate = .94;
    utterance.pitch = 1;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

async function startListening() {
  await ensureMicrophone();
  state.chunks = [];
  state.discardRecording = false;
  state.hasSpeech = false;
  state.answerStartedAt = Date.now();
  state.lastSpeechAt = Date.now();

  const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? { mimeType: 'audio/webm;codecs=opus' }
    : {};
  state.mediaRecorder = new MediaRecorder(state.micStream, options);
  state.mediaRecorder.ondataavailable = event => { if (event.data.size) state.chunks.push(event.data); };
  state.mediaRecorder.onstop = processRecordedAnswer;
  state.mediaRecorder.start(250);

  setStage('listening', 'Your answer.');
  $('repeatQuestionButton').disabled = false;
  $('doneAnswerButton').disabled = false;
  monitorSilence();
}

function monitorSilence() {
  clearInterval(state.silenceTimer);
  state.silenceTimer = setInterval(() => {
    if (!state.analyser || state.mediaRecorder?.state !== 'recording') return;
    state.analyser.getFloatTimeDomainData(state.analyserData);
    let sum = 0;
    for (const sample of state.analyserData) sum += sample * sample;
    const rms = Math.sqrt(sum / state.analyserData.length);
    updateListeningWave(rms);

    const now = Date.now();
    const elapsed = now - state.answerStartedAt;
    if (rms > SPEECH_THRESHOLD) {
      state.hasSpeech = true;
      state.lastSpeechAt = now;
    }

    if (state.hasSpeech && now - state.lastSpeechAt >= SILENCE_MS && elapsed > 2500) {
      stopListening();
    } else if (!state.hasSpeech && elapsed >= NO_SPEECH_TIMEOUT_MS) {
      cancelListening(true);
      showToast('No answer was detected. The question will play again.');
      setTimeout(() => speakQuestion(state.currentQuestion.question), 700);
    } else if (elapsed >= MAX_ANSWER_MS) {
      stopListening();
    }
  }, 120);
}

function updateListeningWave(rms) {
  const strength = Math.min(1, rms * 18);
  const bars = [...$('voiceWave').children];
  bars.forEach((bar, index) => {
    const centre = 1 - Math.abs(index - 4) / 5;
    bar.style.height = `${12 + strength * (28 + centre * 36)}px`;
  });
}

function stopListening() {
  clearInterval(state.silenceTimer);
  if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
  $('doneAnswerButton').disabled = true;
  $('repeatQuestionButton').disabled = true;
  setStage('processing', 'Reviewing your answer...');
}

function cancelListening(discard) {
  clearInterval(state.silenceTimer);
  if (discard) state.discardRecording = true;
  if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
}

async function processRecordedAnswer() {
  resetWaveBars();
  if (state.discardRecording) {
    state.chunks = [];
    return;
  }

  const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
  try {
    const audioBase64 = await blobToBase64(blob);
    const transcriptResult = await callApi('transcribe', {
      audioBase64,
      mimeType: blob.type
    });
    const transcript = String(transcriptResult.transcript || '').trim();

    if (transcript.split(/\s+/).filter(Boolean).length < 3) {
      showToast('We could not hear enough of your answer. Please try again.');
      await wait(650);
      return speakQuestion(state.currentQuestion.question);
    }

    const question = state.currentQuestion;
    const result = await callApi('reviewAndContinue', {
      profile: state.profile,
      blueprint: state.blueprint,
      jdText: state.jdText,
      question,
      transcript,
      previousAnswers: state.answers,
      questionNumber: state.questionNumber,
      policy: state.policy
    });

    state.answers.push({
      question: question.question,
      category: question.category,
      competency: question.competency,
      purpose: question.purpose,
      isFollowUp: Boolean(question.isFollowUp),
      transcript,
      evaluation: result.evaluation
    });
    state.coverage = result.coverage || state.coverage;

    if (result.shouldFinish || !result.nextQuestion) return finishInterview();
    state.currentQuestion = result.nextQuestion;
    state.questionNumber += 1;
    await presentQuestion();
  } catch (error) {
    console.error(error);
    showToast(error.message, 5000);
    await wait(900);
    await speakQuestion(state.currentQuestion.question);
  }
}

function resetWaveBars() {
  [...$('voiceWave').children].forEach(bar => bar.style.height = '');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

$('repeatQuestionButton').onclick = async () => {
  cancelListening(true);
  await wait(200);
  await speakQuestion(state.currentQuestion.question);
};
$('doneAnswerButton').onclick = stopListening;

$('endEarlyButton').onclick = () => {
  if (state.answers.length < 5) return;
  if (!window.confirm('Finish now and create your preparation report?')) return;
  cancelListening(true);
  finishInterview();
};

async function finishInterview() {
  if (!state.answers.length) return;
  clearInterval(state.timerHandle);
  cancelListening(true);
  setBusy(true, 'Creating your preparation sheet...');
  try {
    state.report = await callApi('finaliseReport', {
      profile: state.profile,
      blueprint: state.blueprint,
      jdText: state.jdText,
      answers: state.answers,
      coverage: state.coverage
    });
    renderReport();
    showScreen('reportScreen');
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

function list(items = []) {
  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function renderReport() {
  const report = state.report || {};
  const scores = report.scores || {};
  $('reportContent').innerHTML = `
    <section class="report-card">
      <h3>Overall readiness</h3>
      <p>${escapeHtml(report.summary || '')}</p>
      <div class="score-grid">
        <div class="score-item">Overall<strong>${scores.overall || 0}%</strong></div>
        <div class="score-item">Relevance<strong>${scores.relevance || 0}/5</strong></div>
        <div class="score-item">Structure<strong>${scores.structure || 0}/5</strong></div>
        <div class="score-item">Examples<strong>${scores.examples || 0}/5</strong></div>
        <div class="score-item">Clarity<strong>${scores.clarity || 0}/5</strong></div>
      </div>
    </section>
    <section class="report-card"><div class="feedback-columns">
      <div class="feedback-box"><h3>Strongest areas</h3>${list(report.strengths)}</div>
      <div class="feedback-box"><h3>Priorities to improve</h3>${list(report.improvements)}</div>
    </div></section>
    <section class="report-card"><h3>Your preparation plan</h3>${list(report.practicePlan)}</section>
    <section class="report-card"><h3>Role research topics</h3>${list(report.roleResearchTopics)}</section>
    <section class="report-card"><h3>Question-by-question feedback</h3>
      ${state.answers.map((answer, index) => `
        <div class="answer-review">
          <strong>${index + 1}. ${escapeHtml(answer.question)}</strong>
          <p><b>Area assessed:</b> ${escapeHtml(answer.competency || answer.category || '')}</p>
          <p><b>Your response:</b> ${escapeHtml(answer.transcript)}</p>
          <p><b>What worked:</b> ${escapeHtml((answer.evaluation.strengths || []).join(' · '))}</p>
          <p><b>Improve:</b> ${escapeHtml((answer.evaluation.improvements || []).join(' · '))}</p>
          <p class="improved"><b>Better-framed response:</b><br>${escapeHtml(answer.evaluation.improvedResponse || '')}</p>
        </div>`).join('')}
    </section>`;
}

$('downloadPdfButton').onclick = () => {
  const { jsPDF } = window.jspdf;
  const document = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 16;
  const maxWidth = 178;
  let y = 18;
  const line = (text, size = 10, bold = false) => {
    document.setFont('helvetica', bold ? 'bold' : 'normal');
    document.setFontSize(size);
    const parts = document.splitTextToSize(String(text || ''), maxWidth);
    if (y + parts.length * 5 > 282) { document.addPage(); y = 18; }
    document.text(parts, margin, y);
    y += parts.length * 5 + 3;
  };

  line('Interview Practice - Personal Preparation Sheet', 18, true);
  line(`Target role: ${state.profile?.targetRole || 'Not specified'}`, 11);
  line(`Questions completed: ${state.answers.length}`, 11);
  line(`Overall readiness: ${state.report.scores?.overall || 0}%`, 14, true);
  line(state.report.summary || '');
  line('Strongest areas', 13, true);
  (state.report.strengths || []).forEach(item => line('• ' + item));
  line('Priorities to improve', 13, true);
  (state.report.improvements || []).forEach(item => line('• ' + item));
  line('Practice plan', 13, true);
  (state.report.practicePlan || []).forEach(item => line('• ' + item));
  line('Role research topics', 13, true);
  (state.report.roleResearchTopics || []).forEach(item => line('• ' + item));
  state.answers.forEach((answer, index) => {
    line(`${index + 1}. ${answer.question}`, 13, true);
    line(`Area assessed: ${answer.competency || answer.category || ''}`);
    line('Your response: ' + answer.transcript);
    line('What worked: ' + (answer.evaluation.strengths || []).join('; '));
    line('Improve: ' + (answer.evaluation.improvements || []).join('; '));
    line('Better-framed response:', 11, true);
    line(answer.evaluation.improvedResponse || '');
  });
  document.save('Interview-Practice-Preparation-Sheet.pdf');
};

$('restartButton').onclick = () => location.reload();

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

window.addEventListener('beforeunload', () => {
  clearInterval(state.timerHandle);
  clearInterval(state.silenceTimer);
  state.micStream?.getTracks().forEach(track => track.stop());
  if (state.questionAudioUrl) URL.revokeObjectURL(state.questionAudioUrl);
});

initialise();
