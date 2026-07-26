const CONFIG = {
  GEMINI_MODEL: 'gemini-3.5-flash',
  GROQ_TEXT_MODEL: 'openai/gpt-oss-120b',
  GROQ_TRANSCRIBE_MODEL: 'whisper-large-v3-turbo',
  DEFAULT_MIN_QUESTIONS: 8,
  DEFAULT_TARGET_QUESTIONS: 12,
  DEFAULT_MAX_QUESTIONS: 16,
  ABSOLUTE_MAX_QUESTIONS: 20
};

function doGet() {
  return jsonResponse_({
    ok: true,
    data: {
      service: 'Interview Practice API',
      status: 'ready',
      version: '2.1-current-models',
      geminiModel: CONFIG.GEMINI_MODEL,
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
          version: '2.1-current-models',
          geminiModel: CONFIG.GEMINI_MODEL,
          groqModel: CONFIG.GROQ_TEXT_MODEL
        };
        break;
      case 'prepareInterview':
        data = prepareInterview_(body);
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
  const prompt = `You are designing a realistic voice-only mock job interview. Analyse the candidate CV and exact job description before asking anything.

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

Interview policy:
- Minimum questions: ${policy.minQuestions}
- Normal target: ${policy.targetQuestions}
- Maximum questions: ${policy.maxQuestions}
- Later questions are generated dynamically from actual answers.

Rules:
- Extract the real target role and organisation where available.
- Build 6 to 10 specific competencies from the CV and JD, ranked by importance.
- Use actual projects, tools, responsibilities, sectors, achievements and requirements.
- Never invent candidate experience, employers, qualifications, tools or results.
- Make the first question tailored and substantial. Avoid a completely generic opening.
- Generate only the first question, not a fixed list.`;

  const result = callGeminiJson_(prompt);
  if (!result.profile || !result.blueprint || !isQuestion_(result.firstQuestion)) {
    throw new Error('Gemini returned an invalid interview setup.');
  }
  result.policy = policy;
  logSession_('PREPARED', result.profile.targetRole || '', policy.targetQuestions, '');
  return result;
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
      language: 'en'
    },
    muteHttpExceptions: true
  });

  const parsed = parseHttpJson_(response, 'Groq transcription');
  return { transcript: String(parsed.text || '').trim() };
}

function reviewAndContinueWithGroq_(body) {
  const currentQuestion = body.question || body.currentQuestion || {};
  const transcript = cleanText_(body.transcript, 18000);
  if (!isQuestion_(currentQuestion)) throw new Error('The current question is missing.');
  if (!transcript) throw new Error('The answer transcript is empty.');

  const previousAnswers = Array.isArray(body.previousAnswers) ? body.previousAnswers : [];
  const questionNumber = Math.max(1, Number(body.questionNumber || previousAnswers.length + 1));
  const policy = normalisePolicy_(body.policy || body);
  const blueprint = body.blueprint || {};
  const history = compactHistory_(previousAnswers, 10);

  const prompt = `You are running a realistic adaptive mock interview. Privately evaluate the current answer, track competency coverage, and choose the most useful next question.

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

Rules:
- Scores are 1 to 5. Be constructive, specific and honest.
- Improved responses may use only facts in the profile, CV evidence or candidate answer.
- Never invent metrics, employers, projects, qualifications or responsibilities.
- Base the next question on the answer, CV and a specific JD requirement.
- Ask a direct follow-up when the answer is vague, lacks personal action/result, or introduces a claim worth probing.
- A follow-up must explicitly connect to something just said.
- Never ask consecutive follow-ups on the same answer.
- Avoid repeating or lightly rewording earlier questions.
- Do not ask more than two questions on one competency unless it is critical and still weak.
- Do not reveal coaching feedback in the next question.
- Never finish before ${policy.minQuestions}; finish at ${policy.maxQuestions}.
- Around ${policy.targetQuestions}, finish only if critical/high-priority competencies have reasonable coverage.`;

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
      question: cleanText_(answer.question, 1500),
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
      messages: [{ role: 'user', content: prompt }],
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
      question: cleanText_(answer.question, 1200),
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
  if (!chosen) {
    chosen = competencies[0] || {
      name: 'role suitability',
      whyItMatters: 'the requirements of the role'
    };
  }
  return {
    question: 'Can you give a specific example that demonstrates your ' + chosen.name +
      ', explain what you personally did, and describe the outcome?',
    category: 'role-fit',
    competency: chosen.name || 'role suitability',
    purpose: chosen.whyItMatters || 'Assess evidence relevant to the role.',
    isFollowUp: false
  };
}

function isQuestion_(value) {
  return Boolean(value && typeof value.question === 'string' && value.question.trim().length > 8);
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
