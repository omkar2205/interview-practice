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
  MAX_QUESTION_WORDS: 20,
  MAX_FOLLOWUPS: 3,
  MAX_FOLLOWUPS_PER_STAGE: 1
};

const STAGE_SEQUENCE = [
  { id: 'introduction', label: 'Introduction', quota: 1 },
  { id: 'background', label: 'Background', quota: 2 },
  { id: 'behavioural', label: 'Behavioural', quota: 3 },
  { id: 'resume', label: 'CV discussion', quota: 2 },
  { id: 'job_fit', label: 'Role fit', quota: 2 },
  { id: 'contribution', label: 'Contribution', quota: 1 },
  { id: 'career_clarification', label: 'Career history', quota: 1, conditional: true },
  { id: 'closing', label: 'Closing', quota: 1 }
];

const QUESTION_RULES = `
QUESTION STYLE:
- Ask exactly one question at a time.
- Use simple, natural spoken English.
- Keep the question under 20 words.
- Ask about one idea only.
- Be direct. Do not add an introduction, explanation or coaching.
- Do not combine several tasks with "and".
- Use one question mark only.
- Make the question specific to the supplied focus.
- Never ask for situation, action and result in the same question.
`;

function doGet() {
  return jsonResponse_({
    ok: true,
    data: {
      service: 'Interview Practice API',
      status: 'ready',
      version: '3.2-structured-interview',
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
          version: '3.2-structured-interview',
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

  const prompt = `Analyse this CV and job description to prepare a balanced, structured mock interview.

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
    "currentRole": "",
    "experienceSummary": "",
    "skills": [""],
    "evidence": ["specific evidence taken from the CV"]
  },
  "blueprint": {
    "roleRequirements": ["specific requirement from the JD"],
    "behaviouralCompetencies": [
      {"key":"","name":"","whyRelevant":""}
    ],
    "resumeAreas": [
      {"key":"","name":"","employerOrContext":"","evidence":"","priority":"high|standard"}
    ],
    "jdRequirements": [
      {"key":"","name":"","evidence":"","priority":"critical|high|standard"}
    ],
    "careerSignals": {
      "clarificationNeeded": false,
      "type": "none|employment_gap|frequent_moves|career_change",
      "evidence": "",
      "neutralFocus": ""
    }
  }
}

Rules:
- Extract the real target role and organisation where available.
- Provide at least five distinct behavioural competencies relevant to the role.
- Provide four to six different CV areas across roles, projects, achievements or responsibilities.
- Do not list the same project or achievement under different names.
- Provide four to six different high-value JD requirements.
- Never invent experience, dates, employers, tools, qualifications or results.
- Career clarification must be false unless the CV clearly supports it.
- Flag an employment gap only when reliable month-level dates show an unexplained gap of at least six months.
- Do not infer a gap from year-only dates or missing dates.
- Flag frequent moves only when several clearly short tenures form a meaningful pattern.
- Keep career clarification neutral and never infer health, family, pregnancy, disability, age, religion or other personal matters.`;

  const result = callGeminiJson_(prompt);
  result.profile = normaliseProfile_(result.profile);
  result.blueprint = normaliseBlueprint_(result.blueprint);

  const policy = normalisePolicy_(body);
  const requiredCore = requiredCoreCount_(result.blueprint);
  policy.targetQuestions = requiredCore;
  policy.maxQuestions = Math.min(
    CONFIG.ABSOLUTE_MAX_QUESTIONS,
    Math.max(policy.maxQuestions, requiredCore + 2)
  );

  result.firstQuestion = makeFirstQuestion_(result.profile);
  result.policy = policy;
  logSession_('PREPARED', result.profile.targetRole || '', requiredCore, '');
  return result;
}

function makeFirstQuestion_(profile) {
  const role = cleanText_(profile.targetRole, 120);
  return normaliseQuestion_({
    question: role
      ? 'Please introduce yourself in relation to the ' + role + ' role.'
      : 'Please introduce yourself in relation to your target role.',
    category: 'introduction',
    competency: 'professional introduction',
    purpose: 'Assess how clearly the candidate presents their relevant professional profile.',
    stage: 'introduction',
    stageLabel: 'Introduction',
    focusKey: 'introduction',
    isFollowUp: false
  });
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
  const policy = normalisePolicy_(body.policy || body);
  const profile = normaliseProfile_(body.profile);
  const blueprint = normaliseBlueprint_(body.blueprint);
  const completedAnswers = previousAnswers.concat([{
    question: currentQuestion.question,
    stage: currentQuestion.stage,
    stageLabel: currentQuestion.stageLabel,
    focusKey: currentQuestion.focusKey,
    isFollowUp: currentQuestion.isFollowUp,
    transcript: transcript
  }]);

  const nextStage = getNextStage_(blueprint, completedAnswers);
  const nextFocus = nextStage ? selectStageFocus_(nextStage, profile, blueprint, completedAnswers) : null;
  const history = compactHistory_(previousAnswers, 14);

  const prompt = `You are evaluating one answer in a structured mock interview. Do not change the interview order.

CANDIDATE PROFILE:
${JSON.stringify(profile)}

CURRENT QUESTION:
${JSON.stringify(currentQuestion)}

CURRENT ANSWER:
${transcript}

PREVIOUS INTERVIEW HISTORY:
${JSON.stringify(history)}

NEXT REQUIRED SECTION:
${nextStage ? nextStage.label : 'INTERVIEW COMPLETE'}

NEXT REQUIRED FOCUS:
${JSON.stringify(nextFocus || {})}

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
  "followUp": {
    "needed": false,
    "question": "",
    "reason": ""
  },
  "nextCoreQuestion": {
    "question": "",
    "competency": ""
  }
}

Evaluation rules:
- Scores are 1 to 5.
- Be constructive, specific and evidence-based.
- The improved response may use only facts from the profile, CV evidence or candidate answer.
- Never invent metrics, employers, projects, qualifications or responsibilities.

Follow-up rules:
- Suggest a follow-up only when one important claim needs clarification or one crucial detail is missing.
- Ask about one detail only.
- Do not suggest a follow-up when the current question is already a follow-up.
- Do not use a follow-up merely because the answer could be better; record that in feedback instead.

Next core question rules:
- Generate it only for the exact NEXT REQUIRED SECTION and NEXT REQUIRED FOCUS supplied above.
- Do not return to the current topic unless the supplied focus explicitly requires it.
- For behavioural questions, ask for one example involving the named competency.
- For CV discussion, use the named CV area only.
- For role fit, use the named JD requirement only.
- For contribution, ask how the candidate would help the organisation or team.
- For career history, use neutral wording and only the supplied career signal.
- For closing, ask why this role is the right next step.
${QUESTION_RULES}`;

  const result = callGroqJson_(prompt);
  const evaluation = normaliseEvaluation_(result.evaluation || result);
  const coverage = normaliseCoverage_(result.coverage);
  const totalQuestions = completedAnswers.length;
  const remainingCore = remainingCoreCount_(blueprint, completedAnswers);

  const followUpAllowed = canAskFollowUp_(
    currentQuestion,
    completedAnswers,
    result.followUp,
    policy,
    remainingCore
  );

  let nextQuestion = null;
  if (followUpAllowed) {
    nextQuestion = normaliseQuestion_({
      question: result.followUp.question,
      category: currentQuestion.category,
      competency: currentQuestion.competency,
      purpose: result.followUp.reason || 'Clarify one important part of the previous answer.',
      stage: currentQuestion.stage,
      stageLabel: currentQuestion.stageLabel,
      focusKey: currentQuestion.focusKey,
      isFollowUp: true
    });
  } else if (nextStage && totalQuestions < policy.maxQuestions) {
    const generated = result.nextCoreQuestion || {};
    nextQuestion = normaliseQuestion_({
      question: generated.question || fallbackQuestion_(nextStage, nextFocus, profile, blueprint),
      category: categoryForStage_(nextStage.id),
      competency: generated.competency || nextFocus.name || nextStage.label,
      purpose: nextFocus.instruction || '',
      stage: nextStage.id,
      stageLabel: nextStage.label,
      focusKey: nextFocus.key,
      isFollowUp: false
    });
  }

  return {
    evaluation: evaluation,
    coverage: coverage,
    shouldFinish: !nextQuestion,
    finishReason: !nextQuestion ? 'The structured interview plan is complete.' : '',
    nextQuestion: nextQuestion
  };
}

function canAskFollowUp_(currentQuestion, completedAnswers, followUp, policy, remainingCore) {
  if (!followUp || !followUp.needed || !isQuestion_({ question: followUp.question })) return false;
  if (currentQuestion.isFollowUp) return false;
  if (['background', 'behavioural', 'resume', 'job_fit'].indexOf(currentQuestion.stage) === -1) return false;

  const totalFollowUps = completedAnswers.filter(function(answer) { return Boolean(answer.isFollowUp); }).length;
  const stageFollowUps = completedAnswers.filter(function(answer) {
    return Boolean(answer.isFollowUp) && answer.stage === currentQuestion.stage;
  }).length;

  if (totalFollowUps >= CONFIG.MAX_FOLLOWUPS) return false;
  if (stageFollowUps >= CONFIG.MAX_FOLLOWUPS_PER_STAGE) return false;
  return completedAnswers.length + remainingCore + 1 <= policy.maxQuestions;
}

function getNextStage_(blueprint, answers) {
  const counts = stageCoreCounts_(answers);
  for (let i = 0; i < STAGE_SEQUENCE.length; i++) {
    const stage = STAGE_SEQUENCE[i];
    if (stage.conditional && !careerClarificationNeeded_(blueprint)) continue;
    if ((counts[stage.id] || 0) < stage.quota) return stage;
  }
  return null;
}

function selectStageFocus_(stage, profile, blueprint, answers) {
  const used = answers.filter(function(answer) {
    return !answer.isFollowUp && answer.stage === stage.id;
  }).map(function(answer) { return String(answer.focusKey || ''); });

  if (stage.id === 'introduction') {
    return { key: 'introduction', name: 'professional introduction', instruction: 'Relate the introduction to the target role.' };
  }

  if (stage.id === 'background') {
    if (used.indexOf('current_scope') === -1) {
      return {
        key: 'current_scope',
        name: 'current responsibilities',
        evidence: profile.currentRole || profile.experienceSummary,
        instruction: 'Ask what the candidate currently does and owns.'
      };
    }
    return {
      key: 'career_progression',
      name: 'career progression',
      evidence: profile.experienceSummary,
      instruction: 'Ask how the candidate developed towards this opportunity.'
    };
  }

  if (stage.id === 'behavioural') {
    return firstUnusedObject_(blueprint.behaviouralCompetencies, used, {
      key: 'problem_solving',
      name: 'problem-solving',
      whyRelevant: 'Relevant to most professional roles.'
    }, 'whyRelevant');
  }

  if (stage.id === 'resume') {
    return firstUnusedObject_(blueprint.resumeAreas, used, {
      key: 'relevant_achievement',
      name: 'a relevant achievement',
      evidence: profile.experienceSummary
    }, 'evidence');
  }

  if (stage.id === 'job_fit') {
    return firstUnusedObject_(blueprint.jdRequirements, used, {
      key: 'key_requirement',
      name: 'a key role requirement',
      evidence: (blueprint.roleRequirements || [])[0] || ''
    }, 'evidence');
  }

  if (stage.id === 'contribution') {
    return {
      key: 'company_contribution',
      name: 'value to the organisation',
      evidence: profile.organisation || profile.targetRole,
      instruction: 'Ask how the candidate would help the team or organisation.'
    };
  }

  if (stage.id === 'career_clarification') {
    const signal = blueprint.careerSignals || {};
    return {
      key: 'career_' + (signal.type || 'clarification'),
      name: 'career history clarification',
      evidence: signal.evidence || '',
      instruction: signal.neutralFocus || 'Ask for a brief, neutral explanation of the identified career pattern.'
    };
  }

  return {
    key: 'closing_next_step',
    name: 'motivation for the next step',
    evidence: profile.targetRole,
    instruction: 'Ask why this opportunity is the right next step.'
  };
}

function firstUnusedObject_(items, used, fallback, evidenceField) {
  items = Array.isArray(items) ? items : [];
  let chosen = items.find(function(item) { return used.indexOf(String(item.key || '')) === -1; });
  if (!chosen) chosen = items[0] || fallback;
  return {
    key: chosen.key || slug_(chosen.name || fallback.name),
    name: chosen.name || fallback.name,
    evidence: chosen[evidenceField] || chosen.evidence || '',
    instruction: chosen.whyRelevant || chosen.evidence || ''
  };
}

function fallbackQuestion_(stage, focus, profile, blueprint) {
  focus = focus || {};
  if (stage.id === 'background' && focus.key === 'current_scope') {
    return 'What are your main responsibilities in your current role?';
  }
  if (stage.id === 'background') return 'How has your experience prepared you for this role?';
  if (stage.id === 'behavioural') return 'Tell me about a time you demonstrated ' + (focus.name || 'problem-solving') + '.';
  if (stage.id === 'resume') return 'What did you achieve through ' + (focus.name || 'this experience') + '?';
  if (stage.id === 'job_fit') return 'What experience do you have with ' + (focus.name || 'this requirement') + '?';
  if (stage.id === 'contribution') {
    return profile.organisation
      ? 'How would you add value to ' + profile.organisation + '?'
      : 'How would you add value to this team?';
  }
  if (stage.id === 'career_clarification') {
    const type = blueprint.careerSignals && blueprint.careerSignals.type;
    if (type === 'employment_gap') return 'Could you briefly explain the gap in your employment history?';
    if (type === 'frequent_moves') return 'What influenced your recent job changes?';
    if (type === 'career_change') return 'What motivated your career change?';
    return 'Could you briefly explain this part of your career history?';
  }
  if (stage.id === 'closing') return 'Why is this role the right next step for you?';
  return 'Please introduce yourself in relation to this role.';
}

function requiredCoreCount_(blueprint) {
  return STAGE_SEQUENCE.reduce(function(total, stage) {
    if (stage.conditional && !careerClarificationNeeded_(blueprint)) return total;
    return total + stage.quota;
  }, 0);
}

function remainingCoreCount_(blueprint, answers) {
  const counts = stageCoreCounts_(answers);
  return STAGE_SEQUENCE.reduce(function(total, stage) {
    if (stage.conditional && !careerClarificationNeeded_(blueprint)) return total;
    return total + Math.max(0, stage.quota - (counts[stage.id] || 0));
  }, 0);
}

function stageCoreCounts_(answers) {
  return (answers || []).reduce(function(counts, answer) {
    if (!answer.isFollowUp && answer.stage) counts[answer.stage] = (counts[answer.stage] || 0) + 1;
    return counts;
  }, {});
}

function careerClarificationNeeded_(blueprint) {
  return Boolean(blueprint && blueprint.careerSignals && blueprint.careerSignals.clarificationNeeded);
}

function categoryForStage_(stage) {
  const map = {
    introduction: 'introduction',
    background: 'background',
    behavioural: 'behavioural',
    resume: 'resume',
    job_fit: 'role-fit',
    contribution: 'contribution',
    career_clarification: 'career-history',
    closing: 'closing'
  };
  return map[stage] || 'role-fit';
}

function finaliseReportWithGemini_(body) {
  const answers = Array.isArray(body.answers)
    ? body.answers.slice(0, CONFIG.ABSOLUTE_MAX_QUESTIONS)
    : [];
  if (!answers.length) throw new Error('No completed answers were supplied.');

  const reportAnswers = answers.map(function(answer, index) {
    return {
      number: index + 1,
      stage: cleanText_(answer.stageLabel || answer.stage, 100),
      question: cleanText_(answer.question, 1000),
      category: cleanText_(answer.category, 120),
      competency: cleanText_(answer.competency, 200),
      transcript: cleanText_(answer.transcript, 7000),
      evaluation: answer.evaluation || {}
    };
  });

  const prompt = `Create a detailed personal interview preparation report from this structured mock interview. Be constructive, specific and evidence-based. Never invent experience, responsibilities or results.

PROFILE:
${JSON.stringify(body.profile || {})}

INTERVIEW BLUEPRINT:
${JSON.stringify(body.blueprint || {})}

JOB DESCRIPTION:
${cleanText_(body.jdText, 20000)}

ANSWER REVIEWS BY INTERVIEW SECTION:
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
- Reflect performance across all completed interview sections.
- Give 3 to 6 practical items in strengths, improvements and practicePlan.
- Identify repeated examples, generic answers, missing results, weak role evidence and strong evidence.
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
        {
          role: 'system',
          content: 'You are a concise professional interviewer. Follow the supplied interview stage and output format exactly.'
        },
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

function normaliseProfile_(value) {
  value = value || {};
  return {
    candidateName: cleanText_(value.candidateName, 150),
    targetRole: cleanText_(value.targetRole, 180),
    organisation: cleanText_(value.organisation, 180),
    currentRole: cleanText_(value.currentRole, 220),
    experienceSummary: cleanText_(value.experienceSummary, 2500),
    skills: stringArray_(value.skills, 20),
    evidence: stringArray_(value.evidence, 20)
  };
}

function normaliseBlueprint_(value) {
  value = value || {};
  const roleRequirements = stringArray_(value.roleRequirements, 12);
  const behavioural = objectArray_(value.behaviouralCompetencies, 8, 'behavioural');
  const resumeAreas = objectArray_(value.resumeAreas, 8, 'resume');
  let jdRequirements = objectArray_(value.jdRequirements, 8, 'requirement');

  if (jdRequirements.length < 2) {
    jdRequirements = roleRequirements.slice(0, 6).map(function(name, index) {
      return { key: 'requirement_' + (index + 1), name: name, evidence: name, priority: index < 2 ? 'high' : 'standard' };
    });
  }

  const defaults = [
    { key: 'problem_solving', name: 'problem-solving', whyRelevant: '' },
    { key: 'teamwork', name: 'teamwork', whyRelevant: '' },
    { key: 'communication', name: 'communication', whyRelevant: '' },
    { key: 'prioritisation', name: 'prioritisation', whyRelevant: '' },
    { key: 'adaptability', name: 'adaptability', whyRelevant: '' }
  ];
  defaults.forEach(function(item) {
    if (behavioural.length < 5 && !behavioural.some(function(existing) { return existing.key === item.key; })) {
      behavioural.push(item);
    }
  });

  const signal = value.careerSignals || {};
  const allowedTypes = ['none', 'employment_gap', 'frequent_moves', 'career_change'];
  const type = allowedTypes.indexOf(signal.type) >= 0 ? signal.type : 'none';

  return {
    roleRequirements: roleRequirements,
    behaviouralCompetencies: behavioural.slice(0, 8),
    resumeAreas: resumeAreas.slice(0, 8),
    jdRequirements: jdRequirements.slice(0, 8),
    careerSignals: {
      clarificationNeeded: Boolean(signal.clarificationNeeded) && type !== 'none',
      type: type,
      evidence: cleanText_(signal.evidence, 800),
      neutralFocus: cleanText_(signal.neutralFocus, 500)
    }
  };
}

function objectArray_(value, max, prefix) {
  if (!Array.isArray(value)) return [];
  const seen = {};
  return value.map(function(item, index) {
    item = item || {};
    const name = cleanText_(item.name || item.title, 240);
    if (!name) return null;
    let key = cleanText_(item.key, 100) || slug_(name) || prefix + '_' + (index + 1);
    if (seen[key]) key += '_' + (index + 1);
    seen[key] = true;
    return {
      key: key,
      name: name,
      whyRelevant: cleanText_(item.whyRelevant, 700),
      employerOrContext: cleanText_(item.employerOrContext, 300),
      evidence: cleanText_(item.evidence, 1000),
      priority: cleanText_(item.priority, 30) || 'standard'
    };
  }).filter(Boolean).slice(0, max);
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
  let words = question.replace(/[?]$/, '').split(/\s+/).filter(Boolean);

  if (words.length > CONFIG.MAX_QUESTION_WORDS) {
    const firstClause = question.replace(/[?]$/, '').split(/,|;|\band\b/i)[0].trim();
    const clauseWords = firstClause.split(/\s+/).filter(Boolean);
    words = clauseWords.length >= 5 && clauseWords.length <= CONFIG.MAX_QUESTION_WORDS
      ? clauseWords
      : words.slice(0, CONFIG.MAX_QUESTION_WORDS);
    question = words.join(' ').replace(/[,:;\-]+$/, '') + '?';
  } else if (question && !/[?]$/.test(question)) {
    question = question.replace(/[.!]+$/, '') + '?';
  }

  const stage = cleanText_(value.stage, 80) || 'job_fit';
  return {
    question: question,
    category: cleanText_(value.category, 100) || categoryForStage_(stage),
    competency: cleanText_(value.competency, 180) || 'role suitability',
    purpose: cleanText_(value.purpose, 500),
    stage: stage,
    stageLabel: cleanText_(value.stageLabel, 100) || stageLabelById_(stage),
    focusKey: cleanText_(value.focusKey, 120) || stage,
    isFollowUp: Boolean(value.isFollowUp)
  };
}

function stageLabelById_(id) {
  const match = STAGE_SEQUENCE.find(function(stage) { return stage.id === id; });
  return match ? match.label : id;
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
  return (answers || []).slice(Math.max(0, answers.length - limit)).map(function(answer, index) {
    return {
      number: answers.length - Math.min(answers.length, limit) + index + 1,
      stage: cleanText_(answer.stage, 80),
      focusKey: cleanText_(answer.focusKey, 120),
      question: cleanText_(answer.question, 500),
      competency: cleanText_(answer.competency, 180),
      isFollowUp: Boolean(answer.isFollowUp),
      transcript: cleanText_(answer.transcript, 3500)
    };
  });
}

function isQuestion_(value) {
  return Boolean(value && typeof value.question === 'string' && value.question.trim().length > 5);
}

function stringArray_(value, max) {
  if (!Array.isArray(value)) return [];
  return value.map(function(item) { return cleanText_(item, 1000); }).filter(Boolean).slice(0, max);
}

function slug_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
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
