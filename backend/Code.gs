const CONFIG = {
  GEMINI_MODEL: 'gemini-3.5-flash',
  GEMINI_TTS_MODEL: 'gemini-3.1-flash-tts-preview',
  GEMINI_TTS_VOICE: 'Sulafat',
  GROQ_TEXT_MODEL: 'openai/gpt-oss-120b',
  GROQ_TRANSCRIBE_MODEL: 'whisper-large-v3-turbo',
  DEFAULT_MIN_QUESTIONS: 8,
  DEFAULT_TARGET_QUESTIONS: 12,
  DEFAULT_MAX_QUESTIONS: 16,
  ABSOLUTE_MAX_QUESTIONS: 20,
  MAX_QUESTION_WORDS: 20
};

const QUESTION_RULES = `
INTERVIEW QUESTION STYLE:
- Ask exactly one question at a time.
- Use simple, natural spoken English.
- Keep the question under 20 words.
- Ask about one idea only.
- Be direct. Do not add an introduction, explanation or coaching.
- Do not combine several tasks with "and".
- Do not ask the candidate to cover situation, action and result in one question.
- Use one question mark only.
- Make the question specific to the CV, job description or the candidate's previous answer.
- Good examples: "What interested you in this role?"; "How did you improve the admissions process?"; "What changed after you introduced that tracker?"
- Bad example: "Can you explain the situation, what your role was, what actions you took, and what the final outcome was?"
`;

function doGet() {
  return jsonResponse_({
    ok: true,
    data: {
      service: 'Interview Practice API',
      status: 'ready',
      version: '3.0-voice-flow',
      geminiModel: CONFIG.GEMINI_MODEL,
      ttsModel: CONFIG.GEMINI_TTS_MODEL,
      groqModel: CONFIG.GROQ_TEXT_MODEL
    }
  });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    let data;
    switch (body.action || '') {
      case 'health':
        data = {
          status: 'ready',
          version: '3.0-voice-flow',
          geminiModel: CONFIG.GEMINI_MODEL,
          ttsModel: CONFIG.GEMINI_TTS_MODEL,
          groqModel: CONFIG.GROQ_TEXT_MODEL
        };
        break;
      case 'prepareInterview':
        data = prepareInterview_(body);
        break;
      case 'synthesiseSpeech':
        data = synthesiseSpeechWithGemini_(body.text);
        break;
      case 'transcribe':
        data = transcribeWithGroq_(body.audioBase64, body.mimeType);
        break;
      case 'reviewAndContinue':
        data = reviewAndContinueWithGroq_(body);
        break;
      case 'evaluateAnswer':
        data = reviewAndContinueWithGroq_(body).evaluation;
        break;
      case 'finaliseReport':
        data = finaliseReportWithGemini_(body);
        break;
      default:
        throw new Error('Unknown action: ' + (body.action || ''));
    }
    return jsonResponse_({ ok: true, data: data });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function prepareInterview_(body) {
  const cvText = cleanText_(body.cvText, 50000);
  const jdText = cleanText_(body.jdText, 35000);
  if (cvText.length < 80 || jdText.length < 80) {
    throw new Error('CV and job description text are required.');
  }

  const policy = normalisePolicy_(body);
  const prompt = `You are designing a realistic spoken mock job interview. Analyse the candidate CV and exact job description.

CV:
${cvText}

JOB DESCRIPTION:
${jdText}

Return strict JSON only:
{
  "profile": {
    "candidateName": "",
    "targetRole": "",
    "organisation": "",
    "experienceSummary": "",
    "skills": [""],
    "evidence": ["specific evidence taken from the CV"]
  },
  "blueprint": {
    "roleRequirements": ["specific requirement from the JD"],
    "competencies": [{
      "name": "",
      "priority": "critical|high|standard",
      "whyItMatters": "",
      "cvEvidence": "",
      "jdEvidence": ""
    }]
  },
  "firstQuestion": {
    "question": "",
    "category": "introduction|motivation|behavioural|technical|role-fit|closing",
    "competency": "",
    "purpose": "",
    "isFollowUp": false
  }
}

Interview policy: minimum ${policy.minQuestions}, normal target ${policy.targetQuestions}, maximum ${policy.maxQuestions}.
Later questions will be generated from the candidate's actual answers.

Rules:
- Extract the real target role and organisation where available.
- Build 6 to 10 specific competencies from the CV and JD, ranked by importance.
- Use actual projects, tools, responsibilities, sectors, achievements and role requirements.
- Never invent experience, employers, qualifications, tools or results.
- Generate only the first question, not a fixed list.
- The opening question must reference either the target role, organisation, or a clear CV strength.
${QUESTION_RULES}`;

  const result = callGeminiJson_(prompt);
  if (!result.profile || !result.blueprint || !isQuestion_(result.firstQuestion)) {
    throw new Error('Gemini returned an invalid interview setup.');
  }
  result.firstQuestion = normaliseQuestion_(result.firstQuestion);
  result.policy = policy;
  logSession_('PREPARED', result.profile.targetRole || '', policy.targetQuestions, '');
  return result;
}

function synthesiseSpeechWithGemini_(text) {
  text = cleanText_(text, 600);
  if (!text) throw new Error('No question text was supplied for speech.');

  const key = requiredProperty_('GEMINI_API_KEY');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(CONFIG.GEMINI_TTS_MODEL) + ':generateContent?key=' + encodeURIComponent(key);

  const voicePrompt = `Read the interview question exactly as written. Use a warm, calm, professional British English voice. Speak naturally at a moderate pace. Do not add or remove words.\n\n${text}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: voicePrompt }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: CONFIG.GEMINI_TTS_VOICE }
          }
        }
      }
    }),
    muteHttpExceptions: true
  });

  const parsed = parseHttpJson_(response, 'Gemini voice');
  const part = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content &&
    parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0];
  const inlineData = part && (part.inlineData || part.inline_data);
  if (!inlineData || !inlineData.data) throw new Error('Gemini voice returned no audio.');

  return {
    audioBase64: inlineData.data,
    mimeType: inlineData.mimeType || inlineData.mime_type || 'audio/L16;rate=24000',
    sampleRate: 24000,
    voice: CONFIG.GEMINI_TTS_VOICE
  };
}

function transcribeWithGroq_(audioBase64, mimeType) {
  if (!audioBase64) throw new Error('No audio was received.');
  const key = requiredProperty_('GROQ_API_KEY');
  const blob = Utilities.newBlob(
    Utilities.base64Decode(audioBase64),
    mimeType || 'audio/webm',
    'answer.' + mimeToExtension_(mimeType)
  );

  const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + key },
    payload: {
      file: blob,
      model: CONFIG.GROQ_TRANSCRIBE_MODEL,
      response_format: 'json',
      language: 'en',
      prompt: 'Transcribe a job interview answer accurately. Preserve names, employers, tools and role-specific terminology.'
    },
    muteHttpExceptions: true
  });

  const parsed = parseHttpJson_(response, 'Groq transcription');
  return { transcript: String(parsed.text || '').trim() };
}

function reviewAndContinueWithGroq_(body) {
  const currentQuestion = normaliseQuestion_(body.question || body.currentQuestion || {});
  const transcript = cleanText_(body.transcript, 18000);
  if (!isQuestion_(currentQuestion)) throw new Error('The current question is missing.');
  if (!transcript) throw new Error('The answer transcript is empty.');

  const previousAnswers = Array.isArray(body.previousAnswers) ? body.previousAnswers : [];
  const questionNumber = Math.max(1, Number(body.questionNumber || previousAnswers.length + 1));
  const policy = normalisePolicy_(body.policy || body);
  const blueprint = body.blueprint || {};
  const history = compactHistory_(previousAnswers, 10);

  const prompt = `You are running a realistic adaptive mock interview. Privately evaluate the current answer, update competency coverage, and choose the next question.

CANDIDATE PROFILE:
${JSON.stringify(body.profile || {})}

INTERVIEW BLUEPRINT:
${JSON.stringify(blueprint)}

JOB DESCRIPTION:
${cleanText_(body.jdText, 18000)}

PREVIOUS QUESTIONS AND ANSWERS:
${JSON.stringify(history)}

CURRENT QUESTION NUMBER: ${questionNumber}
CURRENT QUESTION:
${JSON.stringify(currentQuestion)}

CURRENT ANSWER:
${transcript}

POLICY: minimum ${policy.minQuestions}, target ${policy.targetQuestions}, maximum ${policy.maxQuestions}.

Return strict JSON only:
{
  "evaluation": {
    "scores": {"relevance":1,"structure":1,"specificity":1,"clarity":1},
    "strengths": [""],
    "improvements": [""],
    "framework": "STAR|PREP|Past-Present-Future|Direct",
    "improvedResponse": "",
    "answerEvidence": ["facts actually stated"],
    "missingEvidence": ["important missing detail"]
  },
  "coverage": {
    "coveredCompetencies": [""],
    "weakCompetencies": [""],
    "remainingCompetencies": [""]
  },
  "decision": {
    "shouldFinish": false,
    "reason": "",
    "nextQuestion": {
      "question": "",
      "category": "motivation|behavioural|technical|role-fit|closing",
      "competency": "",
      "purpose": "",
      "isFollowUp": false
    }
  }
}

Evaluation rules:
- Scores are 1 to 5. Be constructive, specific and honest.
- Improved responses may use only facts in the profile, CV evidence or candidate answer.
- Never invent metrics, employers, projects, qualifications or responsibilities.

Adaptive interview rules:
- Base the next question on the answer, CV and one specific JD requirement.
- If the answer is vague, ask one short follow-up about the single most important missing detail.
- If the candidate mentions a useful claim, ask one direct question about that claim.
- Never ask consecutive follow-ups about the same answer.
- Avoid repeated or lightly reworded questions.
- Do not ask more than two questions on one competency unless it is critical and still weak.
- Do not reveal coaching feedback in the next question.
- Never finish before ${policy.minQuestions}; finish at ${policy.maxQuestions}.
- Around ${policy.targetQuestions}, finish only if critical and high-priority competencies have reasonable coverage.
${QUESTION_RULES}`;

  const result = callGroqJson_(prompt);
  const evaluation = normaliseEvaluation_(result.evaluation || result);
  const coverage = normaliseCoverage_(result.coverage);
  const decision = result.decision || {};

  let shouldFinish = Boolean(decision.shouldFinish);
  if (questionNumber < policy.minQuestions) shouldFinish = false;
  if (questionNumber >= policy.maxQuestions) shouldFinish = true;
  if (questionNumber < policy.targetQuestions &&
      coverage.remainingCompetencies.length + coverage.weakCompetencies.length > 0) {
    shouldFinish = false;
  }

  let nextQuestion = decision.nextQuestion;
  if (!shouldFinish && !isQuestion_(nextQuestion)) {
    nextQuestion = fallbackNextQuestion_(blueprint, currentQuestion, history);
  }
  if (!shouldFinish) nextQuestion = normaliseQuestion_(nextQuestion);

  return {
    evaluation: evaluation,
    coverage: coverage,
    shouldFinish: shouldFinish,
    finishReason: String(decision.reason || ''),
    nextQuestion: shouldFinish ? null : nextQuestion
  };
}

function finaliseReportWithGemini_(body) {
  const answers = Array.isArray(body.answers)
    ? body.answers.slice(0, CONFIG.ABSOLUTE_MAX_QUESTIONS)
    : [];
  if (!answers.length) throw new Error('No completed answers were supplied.');

  const reportAnswers = answers.map(function(answer, index) {
    return {
      number: index + 1,
      question: cleanText_(answer.question, 1000),
      category: cleanText_(answer.category, 120),
      competency: cleanText_(answer.competency, 200),
      transcript: cleanText_(answer.transcript, 7000),
      evaluation: answer.evaluation || {}
    };
  });

  const prompt = `Create a detailed personal interview preparation report from this adaptive mock interview. Be constructive, specific and evidence-based. Never invent experience, responsibilities or results.

PROFILE:
${JSON.stringify(body.profile || {})}

INTERVIEW BLUEPRINT:
${JSON.stringify(body.blueprint || {})}

JOB DESCRIPTION:
${cleanText_(body.jdText, 20000)}

FINAL COMPETENCY COVERAGE:
${JSON.stringify(body.coverage || {})}

ANSWER REVIEWS:
${JSON.stringify(reportAnswers)}

Return strict JSON only:
{
  "scores": {"overall":0,"relevance":1,"structure":1,"examples":1,"clarity":1},
  "summary": "",
  "strengths": [""],
  "improvements": [""],
  "practicePlan": [""],
  "strongestAnswer": "",
  "priorityAnswer": "",
  "roleResearchTopics": [""]
}

Rules:
- Overall is 0 to 100; other scores are 1 to 5.
- Reflect the full interview, not only the final answer.
- Give 3 to 6 practical items in strengths, improvements and practicePlan.
- Identify patterns such as generic answers, missing results, weak role evidence, repetition or strong examples.
- Help the candidate prepare genuine answers rather than memorise invented claims.`;

  const report = callGeminiJson_(prompt);
  logSession_('COMPLETED', (body.profile && body.profile.targetRole) || '', answers.length,
    report.scores && report.scores.overall);
  return report;
}

function callGeminiJson_(prompt) {
  const key = requiredProperty_('GEMINI_API_KEY');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(CONFIG.GEMINI_MODEL) + ':generateContent?key=' + encodeURIComponent(key);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    }),
    muteHttpExceptions: true
  });

  const parsed = parseHttpJson_(response, 'Gemini');
  const candidate = parsed.candidates && parsed.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  const text = parts && parts[0] && parts[0].text;
  return parseJsonText_(text);
}

function callGroqJson_(prompt) {
  const key = requiredProperty_('GROQ_API_KEY');
  const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({
      model: CONFIG.GROQ_TEXT_MODEL,
      messages: [
        { role: 'system', content: 'You are a concise professional interviewer. Follow every output-format and question-length rule exactly.' },
        { role: 'user', content: prompt }
      ],
      reasoning_effort: 'low',
      response_format: { type: 'json_object' }
    }),
    muteHttpExceptions: true
  });

  const parsed = parseHttpJson_(response, 'Groq interview review');
  const text = parsed.choices && parsed.choices[0] && parsed.choices[0].message &&
    parsed.choices[0].message.content;
  return parseJsonText_(text);
}

function normalisePolicy_(source) {
  source = source || {};
  const minQuestions = clampNumber_(source.minQuestions, 5, 12, CONFIG.DEFAULT_MIN_QUESTIONS);
  const maxQuestions = clampNumber_(source.maxQuestions, minQuestions,
    CONFIG.ABSOLUTE_MAX_QUESTIONS, CONFIG.DEFAULT_MAX_QUESTIONS);
  const targetQuestions = clampNumber_(source.targetQuestions, minQuestions,
    maxQuestions, CONFIG.DEFAULT_TARGET_QUESTIONS);
  return { minQuestions: minQuestions, targetQuestions: targetQuestions, maxQuestions: maxQuestions };
}

function normaliseQuestion_(value) {
  value = value || {};
  let question = cleanText_(value.question, 700)
    .replace(/^question\s*\d*\s*[:.\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const firstQuestionMark = question.indexOf('?');
  if (firstQuestionMark >= 0) question = question.slice(0, firstQuestionMark + 1);

  let words = question.replace(/\?$/, '').split(/\s+/).filter(Boolean);
  if (words.length > CONFIG.MAX_QUESTION_WORDS) {
    const firstClause = question.replace(/\?$/, '').split(/,|;|\band\b/i)[0].trim();
    const clauseWords = firstClause.split(/\s+/).filter(Boolean);
    words = clauseWords.length >= 5 && clauseWords.length <= CONFIG.MAX_QUESTION_WORDS
      ? clauseWords
      : words.slice(0, CONFIG.MAX_QUESTION_WORDS);
    question = words.join(' ').replace(/[,:;\-]+$/, '') + '?';
  } else if (question && !/[?]$/.test(question)) {
    question = question.replace(/[.!]+$/, '') + '?';
  }

  return {
    question: question,
    category: cleanText_(value.category, 100) || 'role-fit',
    competency: cleanText_(value.competency, 180) || 'role suitability',
    purpose: cleanText_(value.purpose, 500),
    isFollowUp: Boolean(value.isFollowUp)
  };
}

function normaliseEvaluation_(value) {
  value = value || {};
  value.scores = value.scores || {};
  ['relevance', 'structure', 'specificity', 'clarity'].forEach(function(key) {
    value.scores[key] = clampNumber_(value.scores[key], 1, 5, 3);
  });
  value.strengths = stringArray_(value.strengths, 5);
  value.improvements = stringArray_(value.improvements, 5);
  value.answerEvidence = stringArray_(value.answerEvidence, 8);
  value.missingEvidence = stringArray_(value.missingEvidence, 8);
  value.framework = String(value.framework || 'Direct');
  value.improvedResponse = cleanText_(value.improvedResponse, 5000);
  return value;
}

function normaliseCoverage_(value) {
  value = value || {};
  return {
    coveredCompetencies: stringArray_(value.coveredCompetencies, 20),
    weakCompetencies: stringArray_(value.weakCompetencies, 20),
    remainingCompetencies: stringArray_(value.remainingCompetencies, 20)
  };
}

function compactHistory_(answers, limit) {
  return answers.slice(Math.max(0, answers.length - limit)).map(function(answer, index) {
    return {
      number: answers.length - Math.min(answers.length, limit) + index + 1,
      question: cleanText_(answer.question, 500),
      category: cleanText_(answer.category, 100),
      competency: cleanText_(answer.competency, 180),
      isFollowUp: Boolean(answer.isFollowUp),
      transcript: cleanText_(answer.transcript, 3500),
      scores: answer.evaluation && answer.evaluation.scores ? answer.evaluation.scores : {}
    };
  });
}

function fallbackNextQuestion_(blueprint, currentQuestion, history) {
  const competencies = blueprint && Array.isArray(blueprint.competencies)
    ? blueprint.competencies : [];
  const used = history.map(function(item) { return String(item.competency || '').toLowerCase(); });
  let chosen = competencies.find(function(item) {
    return item && item.name && used.indexOf(String(item.name).toLowerCase()) === -1;
  });
  if (!chosen) chosen = competencies[0] || { name: 'role suitability', whyItMatters: '' };

  return normaliseQuestion_({
    question: 'What is your strongest example of ' + chosen.name + '?',
    category: 'role-fit',
    competency: chosen.name || 'role suitability',
    purpose: chosen.whyItMatters || 'Assess evidence relevant to the role.',
    isFollowUp: false
  });
}

function isQuestion_(value) {
  return Boolean(value && typeof value.question === 'string' && value.question.trim().length > 5);
}

function stringArray_(value, max) {
  if (!Array.isArray(value)) return [];
  return value.map(function(item) { return cleanText_(item, 1000); }).filter(Boolean).slice(0, max);
}

function clampNumber_(value, min, max, fallback) {
  const number = Number(value);
  if (!isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function logSession_(status, targetRole, questionCount, score) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) return;
  try {
    const ss = SpreadsheetApp.openById(id);
    let sheet = ss.getSheetByName('Sessions');
    if (!sheet) sheet = ss.insertSheet('Sessions');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Session ID', 'Status', 'Target Role', 'Questions', 'Overall Score']);
    }
    sheet.appendRow([new Date(), Utilities.getUuid(), status, targetRole, questionCount, score]);
  } catch (err) {
    console.warn('Session logging skipped: ' + err.message);
  }
}

function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(name + ' is not configured in Script Properties.');
  return value;
}

function cleanText_(value, max) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function mimeToExtension_(mime) {
  if ((mime || '').includes('ogg')) return 'ogg';
  if ((mime || '').includes('mp4')) return 'm4a';
  if ((mime || '').includes('wav')) return 'wav';
  return 'webm';
}

function parseHttpJson_(response, label) {
  const code = response.getResponseCode();
  const text = response.getContentText();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new Error(label + ' returned non-JSON data (HTTP ' + code + ').');
  }
  if (code < 200 || code >= 300) {
    throw new Error(label + ' error: ' +
      (parsed.error && parsed.error.message ? parsed.error.message : text.slice(0, 500)));
  }
  return parsed;
}

function parseJsonText_(text) {
  if (!text) throw new Error('AI returned an empty response.');
  const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('AI returned invalid JSON.');
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
