const $ = id => document.getElementById(id);

const state = {
  phase: 'setup',
  cvText: '',
  jdText: '',
  profile: null,
  blueprint: null,
  currentQuestion: null,
  questionNumber: 0,
  policy: null,
  coverage: null,
  answers: [],
  claimLedger: [],
  report: null,
  practiceMode: false,
  practiceOriginalIndex: -1,
  practiceResult: null,
  micStream: null,
  mediaRecorder: null,
  audioContext: null,
  analyser: null,
  analyserData: null,
  silenceTimer: null,
  timerHandle: null,
  timerStartedAt: 0,
  pausedTotal: 0,
  pauseStartedAt: 0,
  toastHandle: null,
  questionAudioUrl: null,
  audioResolve: null,
  sessionStopped: false,
  finishStarted: false,
  paused: false,
  captionsVisible: true,
  flowVersion: 0,
  pendingControllers: new Set(),
  audioCache: new Map()
};

const screens = ['setupScreen', 'interviewScreen', 'reportScreen'];
const MIN_AUTO_SUBMIT_MS = 10000;
const THINKING_PAUSE_MS = 7000;
const LONG_ANSWER_PAUSE_MS = 9000;
const LONG_ANSWER_AFTER_MS = 45000;
const NO_SPEECH_RETRY_MS = 20000;
const MAX_ANSWER_MS = 180000;
const MIN_SPEECH_THRESHOLD = 0.008;
const MAX_SPEECH_THRESHOLD = 0.028;
const TTS_ATTEMPTS = 4;

function showScreen(id) {
  screens.forEach(screen => $(screen).classList.toggle('active', screen === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setBusy(on, text = 'Preparing...') {
  $('processingText').textContent = text;
  $('processingOverlay').classList.toggle('hidden', !on);
}

function showToast(message, timeout = 4000) {
  clearTimeout(state.toastHandle);
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  state.toastHandle = setTimeout(() => $('toast').classList.add('hidden'), timeout);
}

function setPhase(phase, status) {
  state.phase = phase;
  $('voiceOrb').className = `voice-orb ${phase}`;
  $('stageStatus').textContent = status || '';
  const labels = {
    preparing: 'Preparing',
    speaking: 'Interviewer speaking',
    listening: 'Listening',
    processing: 'Reviewing answer',
    paused: 'Paused',
    finishing: 'Preparing report'
  };
  $('phaseLabel').textContent = labels[phase] || 'Session in progress';
  $('pauseButton').disabled = !['speaking', 'listening'].includes(phase) || state.practiceMode && phase === 'processing';
}

function configuredPolicy() {
  return {
    minQuestions: Number(window.APP_CONFIG?.MIN_QUESTIONS || 8),
    targetQuestions: Number(window.APP_CONFIG?.TARGET_QUESTIONS || 12),
    maxQuestions: Number(window.APP_CONFIG?.MAX_QUESTIONS || 16)
  };
}

function isFlowActive(flow) {
  return !state.sessionStopped && !state.paused && flow === state.flowVersion;
}

function isCancellation(error) {
  return state.sessionStopped || state.paused || error?.name === 'AbortError' || error?.message === 'Interview ended.';
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

function resetSessionRuntime() {
  state.sessionStopped = false;
  state.finishStarted = false;
  state.paused = false;
  state.flowVersion += 1;
  state.pausedTotal = 0;
  state.pauseStartedAt = 0;
  $('pauseOverlay').classList.add('hidden');
  $('pauseButton').textContent = 'Pause';
}

$('startButton').onclick = async () => {
  try {
    resetSessionRuntime();
    state.practiceMode = false;
    state.practiceResult = null;
    state.jdText = $('jdText').value.trim();
    state.policy = configuredPolicy();
    await ensureMicrophone();
    setBusy(true, 'Building a balanced interview plan...');

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
    state.claimLedger = [];
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
  state.pausedTotal = 0;
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(updateTimer, 500);
  updateTimer();
}

function updateTimer() {
  const pauseAdjustment = state.paused && state.pauseStartedAt ? Date.now() - state.pauseStartedAt : 0;
  const elapsed = Math.max(0, Date.now() - state.timerStartedAt - state.pausedTotal - pauseAdjustment);
  const total = Math.floor(elapsed / 1000);
  $('timer').textContent = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function updateProgress() {
  const total = state.blueprint?.interviewPlan?.length || state.policy?.targetQuestions || 12;
  const progress = state.practiceMode ? 1 : Math.min(1, Math.max(0, state.questionNumber / total));
  $('progressArc').style.strokeDashoffset = String(634.6 * (1 - progress));
}

function stageLabel(question) {
  return question?.stageLabel || String(question?.stage || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

async function presentQuestion() {
  if (state.sessionStopped || state.paused) return;
  if (!state.currentQuestion) return finishInterview();
  updateProgress();
  const label = state.practiceMode ? 'Focused practice' : stageLabel(state.currentQuestion);
  $('questionCounter').textContent = state.practiceMode
    ? label
    : label ? `Question ${state.questionNumber} · ${label}` : `Question ${state.questionNumber}`;
  $('questionText').textContent = state.currentQuestion.question;
  $('questionText').classList.toggle('caption-hidden', !state.captionsVisible);
  $('repeatQuestionButton').disabled = true;
  $('doneAnswerButton').disabled = true;
  $('endEarlyButton').disabled = state.practiceMode || state.answers.length < 5;
  await speakQuestion(state.currentQuestion);
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

function abortPendingRequests() {
  state.pendingControllers.forEach(controller => {
    try { controller.abort(); } catch (_) {}
  });
  state.pendingControllers.clear();
}

function stopAllInterviewActivity() {
  state.sessionStopped = true;
  state.flowVersion += 1;
  clearInterval(state.timerHandle);
  clearInterval(state.silenceTimer);
  clearTimeout(state.toastHandle);
  cancelCurrentTurn(true);
  abortPendingRequests();
  if (state.micStream) {
    state.micStream.getTracks().forEach(track => {
      try { track.stop(); } catch (_) {}
    });
    state.micStream = null;
  }
  resetWaveBars();
  $('endEarlyButton').disabled = true;
  $('pauseButton').disabled = true;
}

function spokenQuestion(question) {
  return [question.transition, question.question].filter(Boolean).join(' ');
}

async function speakQuestion(question) {
  if (state.sessionStopped || state.paused) return;
  const flow = ++state.flowVersion;
  cancelCurrentTurn(true);
  setPhase('speaking', 'Listen to the question.');
  $('repeatQuestionButton').disabled = true;
  $('doneAnswerButton').disabled = true;
  const text = spokenQuestion(question);

  try {
    const clip = await getQuestionAudio(text, flow);
    if (!isFlowActive(flow)) return;
    await playPcmAudio(clip.audioBase64, Number(clip.sampleRate || 24000), flow);
  } catch (error) {
    if (!isFlowActive(flow) || isCancellation(error)) return;
    console.error(error);
    showToast('The interviewer voice is temporarily unavailable. Select Hear again to retry.', 6000);
    setPhase('preparing', 'Select Hear again to retry the question.');
    $('repeatQuestionButton').disabled = false;
    return;
  }

  if (!isFlowActive(flow)) return;
  await wait(420);
  if (!isFlowActive(flow)) return;
  await startListening(flow);
}

async function getQuestionAudio(text, flow) {
  if (state.audioCache.has(text)) return state.audioCache.get(text);
  let lastError;
  for (let attempt = 1; attempt <= TTS_ATTEMPTS; attempt += 1) {
    if (!isFlowActive(flow)) throw new DOMException('Cancelled', 'AbortError');
    try {
      const result = await callApi('synthesiseSpeech', { text });
      state.audioCache.set(text, result);
      return result;
    } catch (error) {
      if (isCancellation(error)) throw error;
      lastError = error;
      if (attempt < TTS_ATTEMPTS) {
        setPhase('processing', 'Preparing the interviewer voice...');
        await wait(450 * attempt);
      }
    }
  }
  throw lastError || new Error('Interviewer voice unavailable.');
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
    audio.volume = Number($('volumeSlider').value || 1);
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
  recorder._noiseFloor = 0.006;
  recorder._continuousSpeechFrames = 0;
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => processRecordedAnswer(flow, recorder, chunks);
  state.mediaRecorder = recorder;
  recorder.start(250);

  setPhase('listening', 'Your answer · select I’m done when finished.');
  $('repeatQuestionButton').disabled = false;
  $('doneAnswerButton').disabled = false;
  monitorSilence(flow, recorder);
}

function adaptiveThreshold(recorder, rms) {
  if (rms < 0.025 && !recorder._hasSpeech) {
    recorder._noiseFloor = recorder._noiseFloor * 0.92 + rms * 0.08;
  } else if (rms < recorder._noiseFloor * 1.6) {
    recorder._noiseFloor = recorder._noiseFloor * 0.985 + rms * 0.015;
  }
  return Math.min(MAX_SPEECH_THRESHOLD, Math.max(MIN_SPEECH_THRESHOLD, recorder._noiseFloor * 2.7));
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
    const threshold = adaptiveThreshold(recorder, rms);
    if (rms > threshold) {
      recorder._continuousSpeechFrames += 1;
      if (recorder._continuousSpeechFrames >= 2) {
        recorder._hasSpeech = true;
        recorder._lastSpeechAt = now;
      }
    } else {
      recorder._continuousSpeechFrames = 0;
    }

    const silenceAllowed = elapsed >= LONG_ANSWER_AFTER_MS ? LONG_ANSWER_PAUSE_MS : THINKING_PAUSE_MS;
    if (recorder._hasSpeech && elapsed >= MIN_AUTO_SUBMIT_MS && now - recorder._lastSpeechAt >= silenceAllowed) {
      stopListening(recorder);
      return;
    }
    if (!recorder._hasSpeech && elapsed >= NO_SPEECH_RETRY_MS) {
      recorder._discard = true;
      stopListening(recorder, true);
      showToast('No answer was detected. The question will play again.');
      setTimeout(() => {
        if (isFlowActive(flow)) speakQuestion(state.currentQuestion);
      }, 700);
      return;
    }
    if (elapsed >= MAX_ANSWER_MS) stopListening(recorder);
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
  if (!discard) setPhase('processing', 'Reviewing your answer...');
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
      if (isFlowActive(flow)) await speakQuestion(state.currentQuestion);
      return;
    }

    if (state.practiceMode) {
      await completeFocusedPractice(flow, transcript);
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

    const answer = {
      question: question.question,
      category: question.category,
      competency: question.competency,
      purpose: question.purpose,
      stage: question.stage,
      stageLabel: question.stageLabel,
      focusKey: question.focusKey,
      planId: question.planId,
      isFollowUp: Boolean(question.isFollowUp),
      transcript,
      evaluation: result.evaluation,
      claimLedgerEntry: result.claimLedgerEntry
    };
    state.answers.push(answer);
    if (result.claimLedgerEntry?.claim) {
      state.claimLedger.push({
        questionNumber: state.answers.length,
        stage: question.stage,
        ...result.claimLedgerEntry
      });
    }
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
    if (isFlowActive(flow)) await speakQuestion(state.currentQuestion);
  }
}

async function completeFocusedPractice(flow, transcript) {
  const original = state.answers[state.practiceOriginalIndex];
  const result = await callApi('evaluatePractice', {
    profile: state.profile,
    blueprint: state.blueprint,
    question: state.currentQuestion,
    transcript
  });
  if (!isFlowActive(flow)) return;
  const oldAverage = averageScores(original.evaluation?.scores);
  const newAverage = averageScores(result.evaluation?.scores);
  state.practiceResult = {
    question: original.question,
    transcript,
    oldAverage,
    newAverage,
    evaluation: result.evaluation
  };
  stopAllInterviewActivity();
  state.practiceMode = false;
  renderReport();
  showScreen('reportScreen');
  showToast(newAverage > oldAverage ? 'Your revised answer improved.' : 'Practice saved. Review the new guidance below.', 5000);
}

function averageScores(scores = {}) {
  const values = Object.values(scores).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

function pauseInterview() {
  if (state.paused || !['speaking', 'listening'].includes(state.phase)) return;
  state.paused = true;
  state.pauseStartedAt = Date.now();
  state.flowVersion += 1;
  cancelCurrentTurn(true);
  setPhase('paused', 'Interview paused.');
  $('pauseOverlay').classList.remove('hidden');
  $('pauseButton').textContent = 'Paused';
}

async function resumeInterview() {
  if (!state.paused) return;
  state.pausedTotal += Date.now() - state.pauseStartedAt;
  state.pauseStartedAt = 0;
  state.paused = false;
  state.flowVersion += 1;
  $('pauseOverlay').classList.add('hidden');
  $('pauseButton').textContent = 'Pause';
  await ensureMicrophone();
  await speakQuestion(state.currentQuestion);
}

$('pauseButton').onclick = pauseInterview;
$('resumeButton').onclick = resumeInterview;
$('captionsButton').onclick = () => {
  state.captionsVisible = !state.captionsVisible;
  $('questionText').classList.toggle('caption-hidden', !state.captionsVisible);
  $('captionsButton').textContent = state.captionsVisible ? 'Hide question' : 'Show question';
};
$('volumeSlider').oninput = () => {
  $('questionAudio').volume = Number($('volumeSlider').value || 0);
};
$('repeatQuestionButton').onclick = async () => {
  if (state.sessionStopped || state.paused) return;
  await speakQuestion(state.currentQuestion);
};
$('doneAnswerButton').onclick = () => stopListening();
$('endEarlyButton').onclick = () => {
  if (state.answers.length < 5 || state.finishStarted || state.practiceMode) return;
  if (!window.confirm('Finish now and create your preparation pack?')) return;
  finishInterview();
};

async function finishInterview() {
  if (!state.answers.length || state.finishStarted) return;
  state.finishStarted = true;
  setPhase('finishing', 'Creating your preparation pack...');
  stopAllInterviewActivity();
  setBusy(true, 'Creating your preparation pack...');
  try {
    state.report = await callApi('finaliseReport', {
      profile: state.profile,
      blueprint: state.blueprint,
      jdText: state.jdText,
      answers: state.answers,
      coverage: state.coverage,
      claimLedger: state.claimLedger
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

async function startFocusedPractice(index) {
  const original = state.answers[index];
  if (!original) return;
  resetSessionRuntime();
  state.practiceMode = true;
  state.practiceOriginalIndex = index;
  state.currentQuestion = {
    question: original.question,
    category: original.category,
    competency: original.competency,
    stage: original.stage,
    stageLabel: 'Focused practice',
    focusKey: original.focusKey,
    planId: original.planId,
    isFollowUp: false,
    transition: ''
  };
  state.questionNumber = 1;
  await ensureMicrophone();
  startSessionTimer();
  showScreen('interviewScreen');
  await presentQuestion();
}

function list(items = [], className = '') {
  return `<ul class="${className}">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function guidanceForAnswer(number) {
  return (state.report?.answerGuidance || []).find(item => Number(item.number) === number) || {};
}

function scoreCard(label, value, rationale = '') {
  return `<div class="score-item">${escapeHtml(label)}<strong>${value}</strong>${rationale ? `<small>${escapeHtml(rationale)}</small>` : ''}</div>`;
}

function checklistCard(title, items, highlight = false) {
  if (!items?.length) return '';
  return `<div class="checklist-card ${highlight ? 'highlight' : ''}"><h4>${escapeHtml(title)}</h4>${list(items)}</div>`;
}

function confidenceBadge(value) {
  const safe = String(value || '').toLowerCase().replace(/\s+/g, '_');
  return `<span class="confidence-badge ${escapeHtml(safe)}">${escapeHtml(String(value || '').replace(/_/g, ' '))}</span>`;
}

function renderReport() {
  const report = state.report || {};
  const scores = report.scores || {};
  const rationale = report.scoreRationale || {};
  const checklist = report.preparationChecklist || {};
  const practice = state.practiceResult ? `
    <section class="report-card practice-result">
      <h3>Focused practice result</h3>
      <p><strong>${escapeHtml(state.practiceResult.question)}</strong></p>
      <p>Previous average: <b>${state.practiceResult.oldAverage.toFixed(1)}/5</b> · New average: <b>${state.practiceResult.newAverage.toFixed(1)}/5</b></p>
      <p>${escapeHtml((state.practiceResult.evaluation.improvements || []).join(' · '))}</p>
    </section>` : '';

  const confidenceRows = (report.confidenceMap || []).map(item => `
    <tr>
      <td>${escapeHtml(item.area)}</td>
      <td>${confidenceBadge(item.cvEvidence)}</td>
      <td>${confidenceBadge(item.interviewEvidence)}</td>
      <td>${confidenceBadge(item.confidence)}</td>
    </tr>`).join('');

  $('reportContent').innerHTML = `
    ${practice}
    <section class="report-card">
      <h3>Interview readiness</h3>
      <p>${escapeHtml(report.summary || '')}</p>
      <div class="score-grid">
        ${scoreCard('Overall', `${scores.overall || 0}%`)}
        ${scoreCard('JD fit', `${scores.jdFit || 0}/5`, rationale.jdFit)}
        ${scoreCard('Evidence', `${scores.evidence || 0}/5`, rationale.evidence)}
        ${scoreCard('Structure', `${scores.structure || 0}/5`, rationale.structure)}
        ${scoreCard('Clarity', `${scores.clarity || 0}/5`, rationale.clarity)}
        ${scoreCard('Motivation', `${scores.motivation || 0}/5`, rationale.motivation)}
      </div>
    </section>

    <section class="report-card">
      <div class="feedback-columns">
        <div class="feedback-box"><h3>Strongest areas</h3>${list(report.strengths || [])}</div>
        <div class="feedback-box"><h3>Priorities to improve</h3>${list(report.priorities || [])}</div>
      </div>
    </section>

    <section class="report-card">
      <h3>Preparation checklist</h3>
      <p class="section-note">Complete these before the real interview.</p>
      <div class="checklist-grid">
        ${checklistCard('Organisation research', checklist.organisationResearch, true)}
        ${checklistCard('JD requirements to prepare', checklist.jdRequirements, true)}
        ${checklistCard('CV examples to practise', checklist.cvExamples)}
        ${checklistCard('Evidence or outcomes to confirm', checklist.missingEvidence)}
        ${checklistCard('Career history points', checklist.careerHistory)}
        ${checklistCard('Practice plan', report.practicePlan || [])}
      </div>
    </section>

    <section class="report-card">
      <div class="two-column-grid">
        <div><h3>Likely interview questions</h3>${list(report.likelyQuestions || [], 'question-list')}</div>
        <div><h3>Questions you could ask</h3>${list(report.candidateQuestions || [], 'question-list')}</div>
      </div>
    </section>

    ${confidenceRows ? `<section class="report-card"><h3>Evidence confidence</h3><p class="section-note">This distinguishes what the CV confirms from what the interview demonstrated.</p><div class="table-scroll"><table class="confidence-table"><thead><tr><th>Area</th><th>CV evidence</th><th>Interview evidence</th><th>Confidence</th></tr></thead><tbody>${confidenceRows}</tbody></table></div></section>` : ''}

    <section class="report-card">
      <h3>Question-by-question feedback</h3>
      ${state.answers.map((answer, index) => {
        const guidance = guidanceForAnswer(index + 1);
        const outline = guidance.answerOutline?.length ? guidance.answerOutline : answer.evaluation?.answerOutline || [];
        const opening = guidance.betterOpening || answer.evaluation?.betterOpening || '';
        const evidence = guidance.evidenceToAdd?.length ? guidance.evidenceToAdd : answer.evaluation?.missingEvidence || [];
        return `
          <div class="answer-review">
            <div class="answer-review-head">
              <div><strong>${index + 1}. ${escapeHtml(answer.question)}</strong><p><b>Section:</b> ${escapeHtml(answer.stageLabel || stageLabel(answer))}</p></div>
              <button class="practice-button" type="button" data-practice-index="${index}">Practise again</button>
            </div>
            <p><b>Your response:</b> ${escapeHtml(answer.transcript)}</p>
            <p><b>What worked:</b> ${escapeHtml((answer.evaluation?.strengths || []).join(' · '))}</p>
            <p><b>Improve:</b> ${escapeHtml((answer.evaluation?.improvements || []).join(' · '))}</p>
            ${opening ? `<p class="improved"><b>Stronger opening:</b><br>${escapeHtml(opening)}</p>` : ''}
            ${outline.length ? `<div class="feedback-box"><h4>Answer outline</h4>${list(outline)}</div>` : ''}
            ${evidence.length ? `<div class="feedback-box"><h4>Evidence to add</h4>${list(evidence)}</div>` : ''}
          </div>`;
      }).join('')}
    </section>`;

  document.querySelectorAll('[data-practice-index]').forEach(button => {
    button.onclick = () => startFocusedPractice(Number(button.dataset.practiceIndex));
  });
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
  const bulletList = items => (items || []).forEach(item => line('- ' + item));
  const checklist = state.report.preparationChecklist || {};

  line('Personal Interview Preparation Pack', 18, true);
  line(`Target role: ${state.profile?.targetRole || 'Not specified'}`, 11);
  line(`Role type: ${state.profile?.roleTemplateLabel || 'General professional'}`, 11);
  line(`Questions completed: ${state.answers.length}`, 11);
  line(`Overall readiness: ${state.report.scores?.overall || 0}%`, 14, true);
  line(state.report.summary || '');

  line('Strongest areas', 13, true); bulletList(state.report.strengths);
  line('Priorities to improve', 13, true); bulletList(state.report.priorities);
  line('Organisation research', 13, true); bulletList(checklist.organisationResearch);
  line('JD requirements to prepare', 13, true); bulletList(checklist.jdRequirements);
  line('CV examples to practise', 13, true); bulletList(checklist.cvExamples);
  line('Evidence or outcomes to confirm', 13, true); bulletList(checklist.missingEvidence);
  line('Likely interview questions', 13, true); bulletList(state.report.likelyQuestions);
  line('Questions to ask the interviewer', 13, true); bulletList(state.report.candidateQuestions);

  state.answers.forEach((answer, index) => {
    const guidance = guidanceForAnswer(index + 1);
    line(`${index + 1}. ${answer.question}`, 13, true);
    line(`Section: ${answer.stageLabel || stageLabel(answer)}`);
    line('Your response: ' + answer.transcript);
    line('What worked: ' + (answer.evaluation?.strengths || []).join('; '));
    line('Improve: ' + (answer.evaluation?.improvements || []).join('; '));
    const opening = guidance.betterOpening || answer.evaluation?.betterOpening;
    if (opening) line('Stronger opening: ' + opening);
    line('Answer outline', 11, true);
    bulletList(guidance.answerOutline?.length ? guidance.answerOutline : answer.evaluation?.answerOutline);
  });
  document.save('Interview-Preparation-Pack.pdf');
};

$('restartButton').onclick = () => location.reload();
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
window.addEventListener('beforeunload', stopAllInterviewActivity);
initialise();
