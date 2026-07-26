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
  mediaRecorder: null,
  chunks: [],
  report: null
};

const screens = ['setupScreen', 'interviewScreen', 'reportScreen'];

function showScreen(id) {
  screens.forEach(screen => $(screen).classList.toggle('active', screen === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setBusy(on, text = 'Processing...') {
  $('processingText').textContent = text;
  $('processingOverlay').classList.toggle('hidden', !on);
}

function apiReady() {
  return Boolean(window.APP_CONFIG?.API_URL);
}

function configuredPolicy() {
  return {
    minQuestions: Number(window.APP_CONFIG?.MIN_QUESTIONS || 8),
    targetQuestions: Number(window.APP_CONFIG?.TARGET_QUESTIONS || 12),
    maxQuestions: Number(window.APP_CONFIG?.MAX_QUESTIONS || 16)
  };
}

async function callApi(action, payload = {}) {
  if (!apiReady()) throw new Error('Backend URL has not been added to config.js.');

  const response = await fetch(window.APP_CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload })
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (_) {
    throw new Error('The backend returned an invalid response. Confirm that config.js contains the deployed Apps Script /exec URL and that the latest Code.gs is deployed.');
  }

  if (!data.ok) throw new Error(data.error || 'Backend request failed.');
  return data.data;
}

async function extractFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();

  if (extension === 'txt') return await file.text();

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

  throw new Error('Unsupported file type.');
}

function validateSetup() {
  state.jdText = $('jdText').value.trim() || state.jdText;
  const ready = state.cvText.trim().length > 80 && state.jdText.trim().length > 80;
  $('startButton').disabled = !ready;
  $('setupMessage').textContent = ready
    ? 'Ready to create your dynamic interview.'
    : 'Both a CV and job description are required.';
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
$('transcriptText').oninput = () => {
  $('submitTranscriptButton').disabled = $('transcriptText').value.trim().length < 10;
};

async function initialise() {
  try {
    if (apiReady()) {
      const result = await callApi('health');
      $('connectionStatus').textContent = result.version
        ? `Backend connected · ${result.version}`
        : 'Backend connected';
    }
  } catch (error) {
    $('connectionStatus').textContent = 'Backend connection failed';
    console.error(error);
  }
}

$('startButton').onclick = async () => {
  try {
    state.jdText = $('jdText').value.trim();
    state.policy = configuredPolicy();
    setBusy(true, 'Analysing your CV and building a role-specific interview...');

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

    showScreen('interviewScreen');
    renderQuestion();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
};

function renderQuestion() {
  const question = state.currentQuestion;
  if (!question) {
    finishInterview();
    return;
  }

  const maximum = state.policy?.maxQuestions || configuredPolicy().maxQuestions;
  $('questionCounter').textContent = `Question ${state.questionNumber} of up to ${maximum} · Dynamic interview`;
  $('questionText').textContent = question.question;
  $('transcriptText').value = '';
  $('submitTranscriptButton').disabled = true;
  $('retryButton').disabled = true;
  $('recordButton').disabled = false;
  $('stopButton').disabled = true;
  $('endEarlyButton').disabled = state.answers.length < 5;
  $('recordingLabel').textContent = question.isFollowUp ? 'Follow-up question' : 'Ready to answer';
  $('recordingHelp').textContent = question.isFollowUp
    ? 'This question follows from your previous response. Answer naturally and add specific detail.'
    : 'Select Start answer and speak naturally.';

  speak(question.question);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.96;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

$('recordButton').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.chunks = [];
    state.mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable = event => {
      if (event.data.size) state.chunks.push(event.data);
    };
    state.mediaRecorder.onstop = () => processAudio(stream);
    state.mediaRecorder.start();

    $('recordButton').disabled = true;
    $('stopButton').disabled = false;
    $('micPulse').classList.add('live');
    $('recordingLabel').textContent = 'Listening...';
    $('recordingHelp').textContent = 'Answer at your own pace, then stop when complete.';
  } catch (error) {
    alert('Microphone access is required. ' + error.message);
  }
};

$('stopButton').onclick = () => {
  if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
};

async function processAudio(stream) {
  stream.getTracks().forEach(track => track.stop());
  $('micPulse').classList.remove('live');
  $('stopButton').disabled = true;

  try {
    setBusy(true, 'Transcribing your response...');
    const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType });
    const audioBase64 = await blobToBase64(blob);
    const result = await callApi('transcribe', {
      audioBase64,
      mimeType: blob.type
    });

    $('transcriptText').value = result.transcript || '';
    $('submitTranscriptButton').disabled = !result.transcript || result.transcript.trim().length < 10;
    $('retryButton').disabled = false;
    $('recordingLabel').textContent = result.transcript ? 'Transcript ready' : 'No speech detected';
    $('recordingHelp').textContent = result.transcript
      ? 'Edit the transcript if needed, then continue.'
      : 'You can type the answer manually or record it again.';
  } catch (error) {
    alert(error.message);
    $('recordButton').disabled = false;
    $('retryButton').disabled = false;
  } finally {
    setBusy(false);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

$('retryButton').onclick = renderQuestion;
$('submitTranscriptButton').onclick = submitCurrentAnswer;

async function submitCurrentAnswer() {
  const transcript = $('transcriptText').value.trim();
  if (!transcript) return;

  try {
    setBusy(true, 'Reviewing your answer and choosing the most useful next question...');
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

    if (result.shouldFinish || !result.nextQuestion) {
      await finishInterview();
      return;
    }

    state.currentQuestion = result.nextQuestion;
    state.questionNumber += 1;
    renderQuestion();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

async function finishInterview() {
  if (!state.answers.length) return;

  try {
    setBusy(true, 'Creating your detailed preparation sheet...');
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

$('endEarlyButton').onclick = () => {
  if (state.answers.length < 5) {
    alert('Complete at least five questions before finishing early.');
    return;
  }
  finishInterview();
};

function list(items = []) {
  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
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
    <section class="report-card">
      <div class="feedback-columns">
        <div class="feedback-box"><h3>Strongest areas</h3>${list(report.strengths)}</div>
        <div class="feedback-box"><h3>Priorities to improve</h3>${list(report.improvements)}</div>
      </div>
    </section>
    <section class="report-card"><h3>Your preparation plan</h3>${list(report.practicePlan)}</section>
    <section class="report-card"><h3>Role research topics</h3>${list(report.roleResearchTopics)}</section>
    <section class="report-card">
      <h3>Question-by-question feedback</h3>
      ${state.answers.map((answer, index) => `
        <div class="answer-review">
          <strong>${index + 1}. ${escapeHtml(answer.question)}</strong>
          <p><b>Area assessed:</b> ${escapeHtml(answer.competency || answer.category || '')}</p>
          <p><b>Your response:</b> ${escapeHtml(answer.transcript)}</p>
          <p><b>What worked:</b> ${escapeHtml((answer.evaluation.strengths || []).join(' · '))}</p>
          <p><b>Improve:</b> ${escapeHtml((answer.evaluation.improvements || []).join(' · '))}</p>
          <p class="improved"><b>Better-framed response:</b><br>${escapeHtml(answer.evaluation.improvedResponse || '')}</p>
        </div>
      `).join('')}
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
    if (y + parts.length * 5 > 282) {
      document.addPage();
      y = 18;
    }
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
initialise();
