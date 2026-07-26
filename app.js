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
  audioContext: null,
  analyser: null,
  analyserData: null,
  silenceTimer: null,
  timerStartedAt: 0,
  timerHandle: null,
  toastHandle: null,
  questionAudioUrl: null,
  audioResolve: null,
  speechResolve: null,
  sessionStopped: false,
  finishStarted: false,
  flowVersion: 0,
  pendingControllers: new Set()
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

function isFlowActive(flow) {
  return !state.sessionStopped && flow === state.flowVersion;
}

function isCancellation(error) {
  return state.sessionStopped || error?.name === 'AbortError' || error?.message === 'Interview ended.';
}

async function callApi(action, payload = {}, allowStopped = false) {
  const url = window.APP_CONFIG?.API_URL;
  if (!url) throw new Error('Backend URL has not been added to config.js.');
  if (state.sessionStopped && !allowStopped) throw new Error('Interview ended.');

  const controller = new AbortController();
  state.pendingControllers.add(controller);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      body: JSON.stringify({ action, ...payload })
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error('The backend returned an invalid response. Deploy the latest backend/Code.gs as a new Apps Script version.');
    }
    if (!data.ok) throw new Error(data.error || 'Backend request failed.');
    return data.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (/Failed to fetch|NetworkError|Load failed/i.test(error?.message || '')) {
      throw new Error('Could not reach the interview backend. Confirm the Apps Script deployment is available to anyone.');
    }
    throw error;
  } finally {
    state.pendingControllers.delete(controller);
  }
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
    await callApi('health');
  } catch (error) {
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
    state.sessionStopped = false;
    state.finishStarted = false;
    state.flowVersion += 1;
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
    if (!isCancellation(error)) alert(error.message);
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

function stageLabel(question) {
  return question?.stageLabel || String(question?.stage || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

async function presentQuestion() {
  if (state.sessionStopped) return;
  if (!state.currentQuestion) return finishInterview();
  updateProgress();
  const label = stageLabel(state.currentQuestion);
  $('questionCounter').textContent = label ? `Question ${state.questionNumber} · ${label}` : `Question ${state.questionNumber}`;
  $('questionText').textContent = state.currentQuestion.question;
  $('repeatQuestionButton').disabled = true;
  $('doneAnswerButton').disabled = true;
  $('endEarlyButton').disabled = state.answers.length < 5;
  await speakQuestion(state.currentQuestion.question);
}

function stopQuestionAudio() {
  const audio = $('questionAudio');
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch (_) {}
  }
  if (state.audioResolve) {
    const resolve = state.audioResolve;
    state.audioResolve = null;
    resolve();
  }
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
  if (state.speechResolve) {
    const resolve = state.speechResolve;
    state.speechResolve = null;
    resolve();
  }
  if (state.questionAudioUrl) {
    try { URL.revokeObjectURL(state.questionAudioUrl); } catch (_) {}
    state.questionAudioUrl = null;
  }
}

function cancelCurrentTurn(discard = true) {
  clearInterval(state.silenceTimer);
  stopQuestionAudio();
  if (state.mediaRecorder?.state === 'recording') {
    state.mediaRecorder._discard = discard;
    try { state.mediaRecorder.stop(); } catch (_) {}
  }
  $('repeatQuestionButton').disabled = true;
  $('doneAnswerButton').disabled = true;
}

function stopAllInterviewActivity() {
  state.sessionStopped = true;
  state.flowVersion += 1;
  clearInterval(state.timerHandle);
  clearInterval(state.silenceTimer);
  clearTimeout(state.toastHandle);
  stopQuestionAudio();
  cancelCurrentTurn(true);
  state.pendingControllers.forEach(controller => {
    try { controller.abort(); } catch (_) {}
  });
  state.pendingControllers.clear();
  if (state.micStream) {
    state.micStream.getTracks().forEach(track => {
      try { track.stop(); } catch (_) {}
    });
    state.micStream = null;
  }
  resetWaveBars();
  $('endEarlyButton').disabled = true;
}

async function speakQuestion(text) {
  if (state.sessionStopped) return;
  const flow = ++state.flowVersion;
  cancelCurrentTurn(true);
  setStage('speaking', 'Listen to the question.');

  try {
    const result = await callApi('synthesiseSpeech', { text });
    if (!isFlowActive(flow)) return;
    await playPcmAudio(result.audioBase64, Number(result.sampleRate || 24000), flow);
  } catch (error) {
    if (!isFlowActive(flow) || isCancellation(error)) return;
    console.warn('Gemini TTS unavailable, using browser voice.', error);
    await speakWithBrowserVoice(text, flow);
  }

  if (!isFlowActive(flow)) return;
  await wait(320);
  if (!isFlowActive(flow)) return;
  await startListening(flow);
}

function playPcmAudio(base64, sampleRate, flow) {
  return new Promise((resolve, reject) => {
    if (!isFlowActive(flow)) return resolve();
    if (!base64) return reject(new Error('No TTS audio returned.'));
    const bytes = base64ToBytes(base64);
    const wav = pcmToWavBlob(bytes, sampleRate, 1, 16);
    state.questionAudioUrl = URL.createObjectURL(wav);
    const audio = $('questionAudio');
    state.audioResolve = resolve;
    audio.src = state.questionAudioUrl;
    audio.onended = () => {
      state.audioResolve = null;
      resolve();
    };
    audio.onerror = () => {
      state.audioResolve = null;
      reject(new Error('Generated voice could not be played.'));
    };
    audio.play().catch(error => {
      state.audioResolve = null;
      reject(error);
    });
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

function speakWithBrowserVoice(text, flow) {
  return new Promise(resolve => {
    if (!isFlowActive(flow) || !('speechSynthesis' in window)) return resolve();
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
    state.speechResolve = resolve;
    utterance.onend = () => { state.speechResolve = null; resolve(); };
    utterance.onerror = () => { state.speechResolve = null; resolve(); };
    speechSynthesis.speak(utterance);
  });
}

async function startListening(flow) {
  if (!isFlowActive(flow)) return;
  await ensureMicrophone();
  if (!isFlowActive(flow)) return;

  const chunks = [];
  const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? { mimeType: 'audio/webm;codecs=opus' }
    : {};
  const recorder = new MediaRecorder(state.micStream, options);
  recorder._discard = false;
  recorder._hasSpeech = false;
  recorder._answerStartedAt = Date.now();
  recorder._lastSpeechAt = Date.now();
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => processRecordedAnswer(flow, recorder, chunks);
  state.mediaRecorder = recorder;
  recorder.start(250);

  setStage('listening', 'Your answer.');
  $('repeatQuestionButton').disabled = false;
  $('doneAnswerButton').disabled = false;
  monitorSilence(flow, recorder);
}

function monitorSilence(flow, recorder) {
  clearInterval(state.silenceTimer);
  state.silenceTimer = setInterval(() => {
    if (!isFlowActive(flow) || !state.analyser || recorder.state !== 'recording') return;
    state.analyser.getFloatTimeDomainData(state.analyserData);
    let sum = 0;
    for (const sample of state.analyserData) sum += sample * sample;
    const rms = Math.sqrt(sum / state.analyserData.length);
    updateListeningWave(rms);

    const now = Date.now();
    const elapsed = now - recorder._answerStartedAt;
    if (rms > SPEECH_THRESHOLD) {
      recorder._hasSpeech = true;
      recorder._lastSpeechAt = now;
    }

    if (recorder._hasSpeech && now - recorder._lastSpeechAt >= SILENCE_MS && elapsed > 2500) {
      stopListening(recorder);
    } else if (!recorder._hasSpeech && elapsed >= NO_SPEECH_TIMEOUT_MS) {
      recorder._discard = true;
      stopListening(recorder, true);
      showToast('No answer was detected. The question will play again.');
      setTimeout(() => {
        if (isFlowActive(flow)) speakQuestion(state.currentQuestion.question);
      }, 700);
    } else if (elapsed >= MAX_ANSWER_MS) {
      stopListening(recorder);
    }
  }, 120);
}

function updateListeningWave(rms) {
  const strength = Math.min(1, rms * 18);
  [...$('voiceWave').children].forEach((bar, index) => {
    const centre = 1 - Math.abs(index - 4) / 5;
    bar.style.height = `${12 + strength * (28 + centre * 36)}px`;
  });
}

function stopListening(recorder = state.mediaRecorder, discard = false) {
  clearInterval(state.silenceTimer);
  if (!recorder || recorder.state !== 'recording') return;
  if (discard) recorder._discard = true;
  recorder.stop();
  $('doneAnswerButton').disabled = true;
  $('repeatQuestionButton').disabled = true;
  if (!discard) setStage('processing', 'Reviewing your answer...');
}

async function processRecordedAnswer(flow, recorder, chunks) {
  resetWaveBars();
  if (recorder._discard || !isFlowActive(flow)) return;
  const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

  try {
    const audioBase64 = await blobToBase64(blob);
    if (!isFlowActive(flow)) return;
    const transcriptResult = await callApi('transcribe', { audioBase64, mimeType: blob.type });
    if (!isFlowActive(flow)) return;
    const transcript = String(transcriptResult.transcript || '').trim();

    if (transcript.split(/\s+/).filter(Boolean).length < 3) {
      showToast('We could not hear enough of your answer. Please try again.');
      await wait(650);
      if (isFlowActive(flow)) await speakQuestion(state.currentQuestion.question);
      return;
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
    if (!isFlowActive(flow)) return;

    state.answers.push({
      question: question.question,
      category: question.category,
      competency: question.competency,
      purpose: question.purpose,
      stage: question.stage,
      stageLabel: question.stageLabel,
      focusKey: question.focusKey,
      isFollowUp: Boolean(question.isFollowUp),
      transcript,
      evaluation: result.evaluation
    });
    state.coverage = result.coverage || state.coverage;

    if (result.shouldFinish || !result.nextQuestion) {
      await finishInterview();
      return;
    }
    state.currentQuestion = result.nextQuestion;
    state.questionNumber += 1;
    await presentQuestion();
  } catch (error) {
    if (isCancellation(error) || !isFlowActive(flow)) return;
    console.error(error);
    showToast(error.message, 5000);
    await wait(900);
    if (isFlowActive(flow)) await speakQuestion(state.currentQuestion.question);
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
  if (state.sessionStopped) return;
  await speakQuestion(state.currentQuestion.question);
};
$('doneAnswerButton').onclick = () => stopListening();

$('endEarlyButton').onclick = () => {
  if (state.answers.length < 5 || state.finishStarted) return;
  if (!window.confirm('Finish now and create your preparation report?')) return;
  finishInterview();
};

async function finishInterview() {
  if (!state.answers.length || state.finishStarted) return;
  state.finishStarted = true;
  stopAllInterviewActivity();
  setBusy(true, 'Creating your preparation sheet...');
  try {
    state.report = await callApi('finaliseReport', {
      profile: state.profile,
      blueprint: state.blueprint,
      jdText: state.jdText,
      answers: state.answers,
      coverage: state.coverage
    }, true);
    renderReport();
    showScreen('reportScreen');
  } catch (error) {
    state.finishStarted = false;
    if (!isCancellation(error)) alert(error.message);
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
          <p><b>Section:</b> ${escapeHtml(answer.stageLabel || stageLabel(answer))}</p>
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
    line(`Section: ${answer.stageLabel || stageLabel(answer)}`);
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
window.addEventListener('beforeunload', stopAllInterviewActivity);
initialise();
