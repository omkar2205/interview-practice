const CONFIG = {
  GEMINI_MODEL: 'gemini-2.5-flash',
  GROQ_TEXT_MODEL: 'llama-3.3-70b-versatile',
  GROQ_TRANSCRIBE_MODEL: 'whisper-large-v3-turbo',
  DEFAULT_QUESTION_COUNT: 8
};

function doGet() {
  return jsonResponse_({ ok: true, data: { service: 'Interview Practice API', status: 'ready' } });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action || '';
    let data;
    switch (action) {
      case 'health': data = { status: 'ready' }; break;
      case 'prepareInterview': data = prepareInterview_(body); break;
      case 'transcribe': data = transcribeWithGroq_(body.audioBase64, body.mimeType); break;
      case 'evaluateAnswer': data = evaluateAnswerWithGroq_(body); break;
      case 'finaliseReport': data = finaliseReportWithGemini_(body); break;
      default: throw new Error('Unknown action: ' + action);
    }
    return jsonResponse_({ ok: true, data: data });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function prepareInterview_(body) {
  const cvText = cleanText_(body.cvText, 45000);
  const jdText = cleanText_(body.jdText, 30000);
  if (cvText.length < 80 || jdText.length < 80) throw new Error('CV and job description text are required.');
  const count = Math.max(5, Math.min(12, Number(body.questionCount || CONFIG.DEFAULT_QUESTION_COUNT)));
  const prompt = `You are preparing a realistic voice-only mock job interview.\n\nCV:\n${cvText}\n\nJOB DESCRIPTION:\n${jdText}\n\nReturn strict JSON only with this shape:\n{"profile":{"candidateName":"","targetRole":"","experienceSummary":"","skills":[],"evidence":[]},"questions":[{"question":"","category":"introduction|motivation|behavioural|technical|role-fit|closing","purpose":""}]}\n\nRules:\n- Produce exactly ${count} questions.\n- Base questions on the CV and job description.\n- Begin with an introduction question.\n- Include motivation, behavioural and role-specific questions.\n- Do not invent candidate experience.\n- Questions must sound natural when spoken aloud.\n- Do not include answers or feedback.`;
  const result = callGeminiJson_(prompt);
  if (!result.profile || !Array.isArray(result.questions) || !result.questions.length) throw new Error('Gemini returned an invalid interview plan.');
  logSession_('PREPARED', result.profile.targetRole || '', result.questions.length, '');
  return result;
}

function transcribeWithGroq_(audioBase64, mimeType) {
  if (!audioBase64) throw new Error('No audio was received.');
  const key = requiredProperty_('GROQ_API_KEY');
  const bytes = Utilities.base64Decode(audioBase64);
  const ext = mimeToExtension_(mimeType);
  const blob = Utilities.newBlob(bytes, mimeType || 'audio/webm', 'answer.' + ext);
  const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + key },
    payload: { file: blob, model: CONFIG.GROQ_TRANSCRIBE_MODEL, response_format: 'json', language: 'en' },
    muteHttpExceptions: true
  });
  const parsed = parseHttpJson_(response, 'Groq transcription');
  return { transcript: String(parsed.text || '').trim() };
}

function evaluateAnswerWithGroq_(body) {
  const key = requiredProperty_('GROQ_API_KEY');
  const question = body.question || {};
  const transcript = cleanText_(body.transcript, 15000);
  if (!transcript) throw new Error('The answer transcript is empty.');
  const prompt = `You are an encouraging but honest interview coach. Evaluate one answer using the candidate evidence and target job. Never invent facts.\n\nCANDIDATE PROFILE:\n${JSON.stringify(body.profile || {})}\n\nJOB DESCRIPTION:\n${cleanText_(body.jdText, 16000)}\n\nQUESTION:\n${question.question || ''}\nCategory: ${question.category || ''}\n\nCANDIDATE ANSWER:\n${transcript}\n\nReturn strict JSON only:\n{"scores":{"relevance":1,"structure":1,"specificity":1,"clarity":1},"strengths":[""],"improvements":[""],"framework":"STAR|PREP|Past-Present-Future|Direct","improvedResponse":"","followUpInsight":""}\n\nScoring is 1 to 5. The improved response must use only facts in the CV/profile or the candidate answer, sound natural when spoken, and normally stay under 180 words.`;
  const payload = {
    model: CONFIG.GROQ_TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.25,
    response_format: { type: 'json_object' }
  };
  const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const parsed = parseHttpJson_(response, 'Groq answer review');
  const text = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
  return parseJsonText_(text);
}

function finaliseReportWithGemini_(body) {
  const answers = Array.isArray(body.answers) ? body.answers : [];
  if (!answers.length) throw new Error('No completed answers were supplied.');
  const prompt = `Create a useful personal interview preparation report from the completed mock interview. Be constructive, specific and evidence-based. Do not invent experience or numerical results.\n\nPROFILE:\n${JSON.stringify(body.profile || {})}\n\nJOB DESCRIPTION:\n${cleanText_(body.jdText, 18000)}\n\nANSWER REVIEWS:\n${JSON.stringify(answers)}\n\nReturn strict JSON only:\n{"scores":{"overall":0,"relevance":1,"structure":1,"examples":1,"clarity":1},"summary":"","strengths":[""],"improvements":[""],"practicePlan":[""],"strongestAnswer":"","priorityAnswer":"","roleResearchTopics":[""]}\n\nOverall is 0-100; other scores are 1-5. Give 3-6 practical items in strengths, improvements and practicePlan.`;
  const report = callGeminiJson_(prompt);
  logSession_('COMPLETED', (body.profile && body.profile.targetRole) || '', answers.length, report.scores && report.scores.overall);
  return report;
}

function callGeminiJson_(prompt) {
  const key = requiredProperty_('GEMINI_API_KEY');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(CONFIG.GEMINI_MODEL) + ':generateContent?key=' + encodeURIComponent(key);
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.25, responseMimeType: 'application/json' }
  };
  const response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  const parsed = parseHttpJson_(response, 'Gemini');
  const text = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0] && parsed.candidates[0].content.parts[0].text;
  return parseJsonText_(text);
}

function logSession_(status, targetRole, questionCount, score) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) return;
  try {
    const ss = SpreadsheetApp.openById(id);
    let sheet = ss.getSheetByName('Sessions');
    if (!sheet) sheet = ss.insertSheet('Sessions');
    if (sheet.getLastRow() === 0) sheet.appendRow(['Timestamp','Session ID','Status','Target Role','Questions','Overall Score']);
    sheet.appendRow([new Date(), Utilities.getUuid(), status, targetRole, questionCount, score]);
  } catch (err) { console.warn('Session logging skipped: ' + err.message); }
}

function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(name + ' is not configured in Script Properties.');
  return value;
}
function cleanText_(value, max) { return String(value || '').replace(/\u0000/g, '').trim().slice(0, max); }
function mimeToExtension_(mime) { if ((mime || '').includes('ogg')) return 'ogg'; if ((mime || '').includes('mp4')) return 'm4a'; if ((mime || '').includes('wav')) return 'wav'; return 'webm'; }
function parseHttpJson_(response, label) {
  const code = response.getResponseCode(); const text = response.getContentText(); let parsed;
  try { parsed = JSON.parse(text); } catch (_) { throw new Error(label + ' returned non-JSON data (HTTP ' + code + ').'); }
  if (code < 200 || code >= 300) throw new Error(label + ' error: ' + (parsed.error && parsed.error.message ? parsed.error.message : text.slice(0, 500)));
  return parsed;
}
function parseJsonText_(text) {
  if (!text) throw new Error('AI returned an empty response.');
  const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (_) { const a=cleaned.indexOf('{'), b=cleaned.lastIndexOf('}'); if(a>=0&&b>a)return JSON.parse(cleaned.slice(a,b+1)); throw new Error('AI returned invalid JSON.'); }
}
function jsonResponse_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
