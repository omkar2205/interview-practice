const CONFIG = {
  VERSION: '4.0-planned-interview',
  PROMPT_VERSION: '2026-07-26-v4',
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
  MAX_FOLLOWUPS_PER_STAGE: 1,
  DUPLICATE_THRESHOLD: 0.62
};

const ROLE_TEMPLATES = {
  graduate: {
    label: 'Graduate or entry-level',
    behavioural: 2,
    resume: 2,
    jobFit: 2,
    preferredCompetencies: ['learning agility', 'teamwork', 'communication', 'problem-solving', 'initiative']
  },
  technical: {
    label: 'Technical',
    behavioural: 2,
    resume: 2,
    jobFit: 3,
    preferredCompetencies: ['problem-solving', 'quality', 'collaboration', 'adaptability', 'prioritisation']
  },
  operations: {
    label: 'Operations',
    behavioural: 3,
    resume: 2,
    jobFit: 2,
    preferredCompetencies: ['prioritisation', 'process improvement', 'stakeholder management', 'problem-solving', 'delivery under pressure']
  },
  sales: {
    label: 'Sales or business development',
    behavioural: 3,
    resume: 2,
    jobFit: 2,
    preferredCompetencies: ['influencing', 'relationship management', 'resilience', 'commercial judgement', 'handling objections']
  },
  people_manager: {
    label: 'People manager',
    behavioural: 3,
    resume: 2,
    jobFit: 2,
    preferredCompetencies: ['leadership', 'coaching', 'conflict management', 'performance management', 'stakeholder management']
  },
  leadership: {
    label: 'Senior leadership',
    behavioural: 3,
    resume: 2,
    jobFit: 3,
    preferredCompetencies: ['strategic thinking', 'transformation', 'commercial judgement', 'executive influence', 'leadership']
  },
  general: {
    label: 'General professional',
    behavioural: 3,
    resume: 2,
    jobFit: 2,
    preferredCompetencies: ['problem-solving', 'communication', 'teamwork', 'prioritisation', 'adaptability']
  }
};

const STAGE_LABELS = {
  introduction: 'Introduction',
  background: 'Background',
  behavioural: 'Behavioural',
  resume: 'CV discussion',
  job_fit: 'Role fit',
  contribution: 'Contribution',
  career_clarification: 'Career history',
  closing: 'Closing'
};

const QUESTION_RULES = `
QUESTION STYLE:
- Ask exactly one question at a time.
- Use simple, natural spoken English.
- Keep the question between 6 and 20 words.
- Ask about one idea only.
- Be direct. Do not add coaching, praise or an explanation.
- Use one question mark only.
- Avoid "Can you please", "Could you explain in detail" and similar filler.
- Do not ask for situation, action and result in the same question.
- Never assume experience that is not present in the CV or answer.
`;

function doGet() {
  return jsonResponse_({
    ok: true,
    data: {
      service: 'Interview Practice API',
      status: 'ready',
      version: CONFIG.VERSION,
      promptVersion: CONFIG.PROMPT_VERSION,
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
          version: CONFIG.VERSION,
          promptVersion: CONFIG.PROMPT_VERSION,
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
        data = reviewAndContinue_(body);
        break;
      case 'evaluatePractice':
        data = evaluatePractice_(body);
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

  const analysisPrompt = `Analyse the CV and job description for a realistic, balanced mock interview.

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
    "seniority": "entry|mid|senior|leadership",
    "roleFamily": "graduate|technical|operations|sales|people_manager|leadership|general"
  },
  "evidenceMap": [
    {
      "key": "",
      "area": "",
      "employerOrContext": "",
      "evidence": "specific CV evidence",
      "priority": "high|standard",
      "sourceConfidence": "high|medium"
    }
  ],
  "behaviouralCompetencies": [
    {"key":"","name":"","whyRelevant":""}
  ],
  "jdRequirements": [
    {"key":"","name":"","evidence":"exact or faithful JD requirement","priority":"critical|high|standard"}
  ],
  "careerSignals": {
    "clarificationNeeded": false,
    "type": "none|employment_gap|frequent_moves|career_change",
    "evidence": "",
    "neutralFocus": ""
  },
  "organisationResearchTopics": ["topics the candidate should research, derived from the JD only"]
}

Rules:
- Extract the real role and organisation where available.
- Classify the role family conservatively.
- Provide at least six distinct CV evidence areas across roles, projects, responsibilities and achievements.
- Do not list the same achievement under different names.
- Provide at least six role-relevant behavioural competencies.
- Provide five to eight distinct high-value JD requirements.
- Never invent dates, employers, tools, results, responsibilities or organisation facts.
- Career clarification must be false unless the CV clearly supports it.
- Flag an employment gap only when reliable month-level dates show an unexplained gap of at least six months.
- Do not infer a gap from year-only dates or missing dates.
- Keep career clarification neutral and avoid personal or protected characteristics.`;

  const analysed = callGeminiJson_(analysisPrompt);
  const profile = normaliseProfile_(analysed.profile);
  const blueprint = normaliseBlueprint_(analysed, profile);
  blueprint.interviewPlan = buildInterviewPlan_(profile, blueprint);

  const policy = normalisePolicy_(body);
  const coreCount = blueprint.interviewPlan.length;
  policy.minQuestions = Math.min(policy.minQuestions, coreCount);
  policy.targetQuestions = coreCount;
  policy.maxQuestions = Math.min(
    CONFIG.ABSOLUTE_MAX_QUESTIONS,
    Math.max(policy.maxQuestions, coreCount + CONFIG.MAX_FOLLOWUPS)
  );

  const firstPlanItem = blueprint.interviewPlan[0];
  const firstQuestion = generateCoreQuestion_(firstPlanItem, profile, blueprint, [], cvText, jdText);

  logSession_('PREPARED', profile.targetRole || '', coreCount, '', profile.roleFamily);
  return {
    profile: profile,
    blueprint: blueprint,
    firstQuestion: firstQuestion,
    policy: policy,
    promptVersion: CONFIG.PROMPT_VERSION
  };
}

function buildInterviewPlan_(profile, blueprint) {
  const template = ROLE_TEMPLATES[profile.roleFamily] || ROLE_TEMPLATES.general;
  const plan = [];
  let order = 1;

  function add(stage, focusKey, focusName, evidence, instruction) {
    plan.push({
      id: 'plan_' + order,
      order: order++,
      stage: stage,
      stageLabel: STAGE_LABELS[stage],
      focusKey: focusKey,
      focusName: focusName,
      evidence: cleanText_(evidence, 1200),
      instruction: cleanText_(instruction, 800)
    });
  }

  add('introduction', 'professional_introduction', 'professional introduction', profile.targetRole,
    'Ask for a concise introduction linked to the target role.');

  if (profile.roleFamily === 'graduate') {
    add('background', 'education_foundation', 'education and relevant projects', profile.experienceSummary,
      'Ask how education, projects or early experience prepared the candidate.');
  } else {
    add('background', 'current_scope', 'current responsibilities', profile.currentRole || profile.experienceSummary,
      'Ask what the candidate currently owns or delivers.');
  }
  add('background', 'career_progression', 'career progression', profile.experienceSummary,
    'Ask how the candidate developed towards this opportunity.');

  selectObjects_(blueprint.behaviouralCompetencies, template.preferredCompetencies, template.behavioural)
    .forEach(function(item) {
      add('behavioural', item.key, item.name, item.whyRelevant,
        'Ask for one specific example demonstrating this competency.');
    });

  blueprint.evidenceMap.slice(0, template.resume).forEach(function(item) {
    add('resume', item.key, item.area, item.evidence,
      'Ask one direct question about this distinct CV evidence area.');
  });

  blueprint.jdRequirements.slice(0, template.jobFit).forEach(function(item) {
    add('job_fit', item.key, item.name, item.evidence,
      'Ask how the candidate meets or would approach this specific role requirement.');
  });

  add('contribution', 'company_contribution', 'value to the organisation', profile.organisation || profile.targetRole,
    'Ask how the candidate would help the team or organisation during the first six months.');

  if (blueprint.careerSignals.clarificationNeeded) {
    add('career_clarification', 'career_' + blueprint.careerSignals.type, 'career history clarification',
      blueprint.careerSignals.evidence, blueprint.careerSignals.neutralFocus);
  }

  add('closing', 'closing_next_step', 'motivation for the next step', profile.targetRole,
    'Ask why this role is the right next step.');

  return plan;
}

function selectObjects_(items, preferredNames, count) {
  items = Array.isArray(items) ? items.slice() : [];
  const preferred = (preferredNames || []).map(function(value) { return String(value).toLowerCase(); });
  items.sort(function(a, b) {
    const ai = preferred.indexOf(String(a.name || '').toLowerCase());
    const bi = preferred.indexOf(String(b.name || '').toLowerCase());
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return items.slice(0, count);
}

function reviewAndContinue_(body) {
  const currentQuestion = normaliseQuestion_(body.question || body.currentQuestion || {});
  const transcript = cleanText_(body.transcript, 18000);
  if (!isQuestion_(currentQuestion)) throw new Error('The current question is missing.');
  if (!transcript) throw new Error('The answer transcript is empty.');

  const previousAnswers = Array.isArray(body.previousAnswers) ? body.previousAnswers : [];
  const profile = normaliseProfile_(body.profile);
  const blueprint = normaliseBlueprint_(body.blueprint, profile);
  const policy = normalisePolicy_(body.policy || body);
  const history = compactHistory_(previousAnswers, 16);

  const evaluation = evaluateAnswerWithGroq_(currentQuestion, transcript, profile, blueprint, history);
  const completedAnswers = previousAnswers.concat([{
    question: currentQuestion.question,
    stage: currentQuestion.stage,
    stageLabel: currentQuestion.stageLabel,
    focusKey: currentQuestion.focusKey,
    planId: currentQuestion.planId,
    isFollowUp: currentQuestion.isFollowUp,
    transcript: transcript,
    evaluation: evaluation.evaluation
  }]);

  const nextPlanItem = getNextPlanItem_(blueprint.interviewPlan, completedAnswers);
  const remainingCore = remainingPlanCount_(blueprint.interviewPlan, completedAnswers);
  const followUpAllowed = canAskFollowUp_(currentQuestion, completedAnswers, evaluation.followUp, policy, remainingCore);
  let nextQuestion = null;

  if (followUpAllowed) {
    nextQuestion = normaliseQuestion_({
      question: evaluation.followUp.question,
      category: categoryForStage_(currentQuestion.stage),
      competency: currentQuestion.competency,
      purpose: evaluation.followUp.reason,
      stage: currentQuestion.stage,
      stageLabel: currentQuestion.stageLabel,
      focusKey: currentQuestion.focusKey,
      planId: currentQuestion.planId,
      isFollowUp: true,
      transition: ''
    });
    if (!questionPasses_(nextQuestion, completedAnswers)) {
      nextQuestion.question = fallbackFollowUp_(evaluation.claimLedgerEntry);
    }
  } else if (nextPlanItem && completedAnswers.length < policy.maxQuestions) {
    nextQuestion = generateCoreQuestion_(
      nextPlanItem,
      profile,
      blueprint,
      completedAnswers,
      '',
      cleanText_(body.jdText, 18000)
    );
  }

  return {
    evaluation: evaluation.evaluation,
    coverage: evaluation.coverage,
    claimLedgerEntry: evaluation.claimLedgerEntry,
    shouldFinish: !nextQuestion,
    finishReason: !nextQuestion ? 'The planned interview is complete.' : '',
    nextQuestion: nextQuestion
  };
}

function evaluatePractice_(body) {
  const question = normaliseQuestion_(body.question || {});
  const transcript = cleanText_(body.transcript, 18000);
  if (!isQuestion_(question) || !transcript) throw new Error('Question and answer are required.');
  const result = evaluateAnswerWithGroq_(
    question,
    transcript,
    normaliseProfile_(body.profile),
    normaliseBlueprint_(body.blueprint, body.profile || {}),
    []
  );
  return {
    evaluation: result.evaluation,
    claimLedgerEntry: result.claimLedgerEntry
  };
}

function evaluateAnswerWithGroq_(question, transcript, profile, blueprint, history) {
  const prompt = `Evaluate one spoken mock-interview answer. Do not write the next core interview question.

TARGET ROLE AND PROFILE:
${JSON.stringify(profile)}

CURRENT QUESTION:
${JSON.stringify(question)}

CURRENT ANSWER:
${transcript}

PREVIOUS HISTORY:
${JSON.stringify(history || [])}

IMPORTANT ROLE REQUIREMENTS:
${JSON.stringify((blueprint.jdRequirements || []).slice(0, 6))}

Return strict JSON only:
{
  "evaluation": {
    "scores": {"relevance":1,"structure":1,"specificity":1,"clarity":1,"roleKnowledge":1},
    "strengths": [""],
    "improvements": [""],
    "framework": "STAR|PREP|Past-Present-Future|Direct",
    "betterOpening": "",
    "answerOutline": ["bullet outline using only genuine facts"],
    "answerEvidence": ["facts actually stated"],
    "missingEvidence": ["important missing detail"]
  },
  "coverage": {
    "coveredCompetencies": [""],
    "weakCompetencies": [""],
    "remainingCompetencies": [""]
  },
  "claimLedgerEntry": {
    "claim": "most important claim made in this answer",
    "support": "what evidence was actually provided",
    "confidence": "high|medium|low|not_demonstrated",
    "missingDetail": "",
    "followUpRecommended": false
  },
  "followUp": {
    "needed": false,
    "question": "",
    "reason": ""
  }
}

Scoring rubric:
- 1: generic, unclear or not demonstrated.
- 2: partly relevant but missing personal action or evidence.
- 3: clear and relevant with some personal detail.
- 4: strong, specific and supported by an outcome.
- 5: concise, highly relevant and supported by convincing evidence.

Rules:
- Evaluate the answer actually given, not an ideal answer.
- Do not assess accent, personality or confidence from a transcript.
- Never invent facts, results or responsibilities.
- A follow-up is justified only for one important role-relevant claim needing one crucial detail.
- Do not recommend a follow-up merely because the answer could be improved.
- The answer outline must be short bullet-style points, not a memorised script.
${QUESTION_RULES}`;

  const result = callGroqJson_(prompt);
  return {
    evaluation: normaliseEvaluation_(result.evaluation),
    coverage: normaliseCoverage_(result.coverage),
    claimLedgerEntry: normaliseClaim_(result.claimLedgerEntry),
    followUp: result.followUp || {}
  };
}

function generateCoreQuestion_(planItem, profile, blueprint, answers, cvText, jdText) {
  const previousQuestions = (answers || []).map(function(answer) { return cleanText_(answer.question, 400); });
  const stageChanged = answers && answers.length && answers[answers.length - 1].stage !== planItem.stage;
  const transition = stageChanged ? transitionForStage_(planItem.stage) : '';

  const prompt = `Write one spoken mock-interview question for the exact planned focus below.

PROFILE:
${JSON.stringify(profile)}

ROLE FAMILY:
${profile.roleFamily}

PLANNED FOCUS:
${JSON.stringify(planItem)}

RELATED CV EVIDENCE:
${cleanText_(planItem.evidence || cvText, 2500)}

RELATED JOB DESCRIPTION:
${cleanText_(jdText, 5000)}

PREVIOUS QUESTIONS:
${JSON.stringify(previousQuestions)}

Return strict JSON only:
{"question":"","competency":""}

Rules:
- Stay within the exact planned stage and focus.
- Do not revisit another CV project, competency or JD requirement.
- Do not repeat or lightly reword a previous question.
- Reference the supplied evidence when it makes the question more specific.
${QUESTION_RULES}`;

  let generated = callGeminiJson_(prompt);
  let question = normaliseQuestion_({
    question: generated.question,
    competency: generated.competency || planItem.focusName,
    purpose: planItem.instruction,
    stage: planItem.stage,
    stageLabel: planItem.stageLabel,
    focusKey: planItem.focusKey,
    planId: planItem.id,
    isFollowUp: false,
    transition: transition
  });

  if (!questionPasses_(question, answers || [])) {
    const retryPrompt = prompt + `
The first draft failed validation because it was generic, repetitive or multi-part. Write a clearly different question.`;
    generated = callGeminiJson_(retryPrompt);
    question = normaliseQuestion_({
      question: generated.question,
      competency: generated.competency || planItem.focusName,
      purpose: planItem.instruction,
      stage: planItem.stage,
      stageLabel: planItem.stageLabel,
      focusKey: planItem.focusKey,
      planId: planItem.id,
      isFollowUp: false,
      transition: transition
    });
  }

  if (!questionPasses_(question, answers || [])) {
    question = normaliseQuestion_({ ...question, question: fallbackQuestion_(planItem, profile, blueprint) });
  }
  return question;
}

function questionPasses_(question, answers) {
  if (!isQuestion_(question)) return false;
  const words = question.question.replace(/[?]/g, '').split(/\s+/).filter(Boolean);
  if (words.length < 5 || words.length > CONFIG.MAX_QUESTION_WORDS) return false;
  if ((question.question.match(/\?/g) || []).length !== 1) return false;
  if (/can you please|could you explain in detail|tell me more about your experience/i.test(question.question)) return false;
  if (/\bwhat\b.+\band\b.+\bwhat\b/i.test(question.question)) return false;

  return !(answers || []).some(function(answer) {
    return questionSimilarity_(question.question, answer.question || '') >= CONFIG.DUPLICATE_THRESHOLD;
  });
}

function questionSimilarity_(left, right) {
  const stop = { the:1, a:1, an:1, to:1, of:1, in:1, on:1, for:1, your:1, you:1, this:1, that:1, how:1, what:1, why:1, tell:1, me:1, about:1 };
  function tokens(value) {
    const unique = {};
    String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).forEach(function(token) {
      if (token.length > 2 && !stop[token]) unique[token] = true;
    });
    return Object.keys(unique);
  }
  const a = tokens(left);
  const b = tokens(right);
  if (!a.length || !b.length) return 0;
  const intersection = a.filter(function(token) { return b.indexOf(token) >= 0; }).length;
  const union = a.concat(b.filter(function(token) { return a.indexOf(token) < 0; })).length;
  return intersection / union;
}

function getNextPlanItem_(plan, answers) {
  plan = Array.isArray(plan) ? plan : [];
  const completed = {};
  (answers || []).forEach(function(answer) {
    if (!answer.isFollowUp && answer.planId) completed[answer.planId] = true;
  });
  return plan.find(function(item) { return !completed[item.id]; }) || null;
}

function remainingPlanCount_(plan, answers) {
  const completed = {};
  (answers || []).forEach(function(answer) {
    if (!answer.isFollowUp && answer.planId) completed[answer.planId] = true;
  });
  return (plan || []).filter(function(item) { return !completed[item.id]; }).length;
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

function finaliseReportWithGemini_(body) {
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, CONFIG.ABSOLUTE_MAX_QUESTIONS) : [];
  if (!answers.length) throw new Error('No completed answers were supplied.');
  const profile = normaliseProfile_(body.profile);
  const blueprint = normaliseBlueprint_(body.blueprint, profile);
  const claimLedger = Array.isArray(body.claimLedger) ? body.claimLedger.slice(0, 30) : [];

  const reportAnswers = answers.map(function(answer, index) {
    return {
      number: index + 1,
      stage: cleanText_(answer.stageLabel || answer.stage, 100),
      question: cleanText_(answer.question, 1000),
      competency: cleanText_(answer.competency, 200),
      transcript: cleanText_(answer.transcript, 7000),
      evaluation: answer.evaluation || {}
    };
  });

  const prompt = `Create a practical personal interview preparation pack from this completed mock interview.

PROFILE:
${JSON.stringify(profile)}

ROLE BLUEPRINT:
${JSON.stringify(blueprint)}

JOB DESCRIPTION:
${cleanText_(body.jdText, 20000)}

ANSWER REVIEWS:
${JSON.stringify(reportAnswers)}

CLAIM LEDGER:
${JSON.stringify(claimLedger)}

Return strict JSON only:
{
  "scores": {"jdFit":1,"evidence":1,"structure":1,"clarity":1,"motivation":1},
  "scoreRationale": {"jdFit":"","evidence":"","structure":"","clarity":"","motivation":""},
  "summary": "",
  "strengths": [""],
  "priorities": [""],
  "practicePlan": [""],
  "preparationChecklist": {
    "organisationResearch": [""],
    "jdRequirements": [""],
    "cvExamples": [""],
    "missingEvidence": [""],
    "careerHistory": [""]
  },
  "likelyQuestions": [""],
  "candidateQuestions": [""],
  "confidenceMap": [
    {"area":"","cvEvidence":"confirmed|partial|none","interviewEvidence":"strong|moderate|weak|not_demonstrated","confidence":"high|medium|low"}
  ],
  "answerGuidance": [
    {"number":1,"betterOpening":"","answerOutline":[""],"evidenceToAdd":[""]}
  ],
  "strongestAnswerNumber": 1,
  "priorityAnswerNumbers": [1]
}

Rules:
- Scores are 1 to 5 using the same evidence-based rubric used during answer evaluation.
- Do not score accent, personality or vocal confidence from transcripts.
- Use only facts present in the CV, JD or answers.
- Preparation checklist items must be practical and role-specific.
- Organisation research must be topics to investigate, not invented facts.
- Give 8 to 10 realistic likely questions without duplicating the completed interview word-for-word.
- Give 4 to 6 thoughtful questions the candidate could ask the real interviewer.
- Answer guidance must be bullet outlines, not polished scripts.
- Confidence labels must distinguish CV evidence from interview evidence.`;

  const report = callGeminiJson_(prompt);
  report.scores = normaliseReportScores_(report.scores);
  report.scores.overall = weightedOverall_(report.scores);
  report.scoreRationale = report.scoreRationale || {};
  report.strengths = stringArray_(report.strengths, 6);
  report.priorities = stringArray_(report.priorities || report.improvements, 6);
  report.practicePlan = stringArray_(report.practicePlan, 8);
  report.likelyQuestions = stringArray_(report.likelyQuestions, 10);
  report.candidateQuestions = stringArray_(report.candidateQuestions, 6);
  report.preparationChecklist = normaliseChecklist_(report.preparationChecklist);
  report.confidenceMap = normaliseConfidenceMap_(report.confidenceMap);
  report.answerGuidance = normaliseAnswerGuidance_(report.answerGuidance, answers.length);
  report.priorityAnswerNumbers = numberArray_(report.priorityAnswerNumbers, answers.length, 4);
  report.strongestAnswerNumber = clampNumber_(report.strongestAnswerNumber, 1, answers.length, 1);
  report.promptVersion = CONFIG.PROMPT_VERSION;

  logSession_('COMPLETED', profile.targetRole || '', answers.length, report.scores.overall, profile.roleFamily);
  return report;
}

function weightedOverall_(scores) {
  const weighted = scores.jdFit * 0.30 + scores.evidence * 0.25 + scores.structure * 0.20 +
    scores.clarity * 0.15 + scores.motivation * 0.10;
  return Math.round((weighted / 5) * 100);
}

function synthesiseSpeechWithGemini_(text) {
  text = cleanText_(text, 900);
  if (!text) throw new Error('No question text was supplied for speech.');
  const key = requiredProperty_('GEMINI_API_KEY');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(CONFIG.GEMINI_TTS_MODEL) + ':generateContent?key=' + encodeURIComponent(key);
  const voicePrompt = `Read this interview transition and question exactly as written. Use one consistent warm, calm, professional British English voice. Speak naturally at a moderate pace. Do not add or remove words.\n\n${text}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: voicePrompt }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CONFIG.GEMINI_TTS_VOICE } } }
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
      prompt: 'Transcribe a job interview answer accurately. Preserve names, employers, tools, figures and role-specific terminology.'
    },
    muteHttpExceptions: true
  });
  const parsed = parseHttpJson_(response, 'Groq transcription');
  return { transcript: String(parsed.text || '').trim() };
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
  const parts = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts;
  return parseJsonText_(parts && parts[0] && parts[0].text);
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
        { role: 'system', content: 'You are a rigorous interview assessor. Follow the output format and evidence rules exactly.' },
        { role: 'user', content: prompt }
      ],
      reasoning_effort: 'low',
      response_format: { type: 'json_object' }
    }),
    muteHttpExceptions: true
  });
  const parsed = parseHttpJson_(response, 'Groq interview review');
  return parseJsonText_(parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content);
}

function normaliseProfile_(value) {
  value = value || {};
  const families = Object.keys(ROLE_TEMPLATES);
  const requestedFamily = String(value.roleFamily || '').toLowerCase();
  const family = families.indexOf(requestedFamily) >= 0 ? requestedFamily : 'general';
  const seniorities = ['entry', 'mid', 'senior', 'leadership'];
  const requestedSeniority = String(value.seniority || '').toLowerCase();
  return {
    candidateName: cleanText_(value.candidateName, 150),
    targetRole: cleanText_(value.targetRole, 180),
    organisation: cleanText_(value.organisation, 180),
    currentRole: cleanText_(value.currentRole, 220),
    experienceSummary: cleanText_(value.experienceSummary, 2500),
    skills: stringArray_(value.skills, 20),
    seniority: seniorities.indexOf(requestedSeniority) >= 0 ? requestedSeniority : 'mid',
    roleFamily: family,
    roleTemplateLabel: ROLE_TEMPLATES[family].label
  };
}

function normaliseBlueprint_(value, profile) {
  value = value || {};
  const evidenceMap = objectArray_(value.evidenceMap || value.resumeAreas, 10, 'evidence', 'area');
  const behavioural = objectArray_(value.behaviouralCompetencies, 10, 'behavioural', 'name');
  const jdRequirements = objectArray_(value.jdRequirements, 10, 'requirement', 'name');
  if (evidenceMap.length < 2) {
    const fallbackEvidence = [
      { key: 'current_scope', area: 'current responsibilities', evidence: (profile && profile.currentRole) || (profile && profile.experienceSummary) || '', priority: 'high' },
      { key: 'relevant_achievement', area: 'a relevant achievement', evidence: (profile && profile.experienceSummary) || '', priority: 'standard' }
    ];
    fallbackEvidence.forEach(function(item) {
      if (evidenceMap.length < 2 && !evidenceMap.some(function(existing) { return existing.key === item.key; })) evidenceMap.push(item);
    });
  }
  if (jdRequirements.length < 2) {
    const skills = (profile && profile.skills) || [];
    [0, 1].forEach(function(index) {
      if (jdRequirements.length < 2) {
        const name = skills[index] || (index === 0 ? 'the core responsibilities of the role' : 'the most important role requirement');
        jdRequirements.push({ key: 'fallback_requirement_' + (index + 1), name: name, area: name, evidence: name, priority: index === 0 ? 'high' : 'standard' });
      }
    });
  }
  const defaults = (ROLE_TEMPLATES[(profile && profile.roleFamily) || 'general'] || ROLE_TEMPLATES.general).preferredCompetencies;
  defaults.forEach(function(name) {
    if (behavioural.length < 6 && !behavioural.some(function(item) { return item.name.toLowerCase() === name.toLowerCase(); })) {
      behavioural.push({ key: slug_(name), name: name, whyRelevant: 'Relevant to this role family.', evidence: '', priority: 'standard' });
    }
  });
  const signal = value.careerSignals || {};
  const allowedTypes = ['none', 'employment_gap', 'frequent_moves', 'career_change'];
  const type = allowedTypes.indexOf(signal.type) >= 0 ? signal.type : 'none';

  return {
    evidenceMap: evidenceMap,
    behaviouralCompetencies: behavioural.slice(0, 10),
    jdRequirements: jdRequirements.slice(0, 10),
    careerSignals: {
      clarificationNeeded: Boolean(signal.clarificationNeeded) && type !== 'none',
      type: type,
      evidence: cleanText_(signal.evidence, 800),
      neutralFocus: cleanText_(signal.neutralFocus, 500)
    },
    organisationResearchTopics: stringArray_(value.organisationResearchTopics, 10),
    interviewPlan: Array.isArray(value.interviewPlan) ? value.interviewPlan : []
  };
}

function objectArray_(value, max, prefix, nameField) {
  if (!Array.isArray(value)) return [];
  const seen = {};
  return value.map(function(item, index) {
    item = item || {};
    const name = cleanText_(item[nameField] || item.name || item.area || item.title, 240);
    if (!name) return null;
    let key = cleanText_(item.key, 100) || slug_(name) || prefix + '_' + (index + 1);
    if (seen[key]) key += '_' + (index + 1);
    seen[key] = true;
    return {
      key: key,
      name: name,
      area: cleanText_(item.area || name, 240),
      whyRelevant: cleanText_(item.whyRelevant, 700),
      employerOrContext: cleanText_(item.employerOrContext, 300),
      evidence: cleanText_(item.evidence, 1200),
      priority: cleanText_(item.priority, 30) || 'standard',
      sourceConfidence: cleanText_(item.sourceConfidence, 30) || 'medium'
    };
  }).filter(Boolean).slice(0, max);
}

function normalisePolicy_(source) {
  source = source || {};
  const minQuestions = clampNumber_(source.minQuestions, 5, 14, CONFIG.DEFAULT_MIN_QUESTIONS);
  const maxQuestions = clampNumber_(source.maxQuestions, minQuestions, CONFIG.ABSOLUTE_MAX_QUESTIONS, CONFIG.DEFAULT_MAX_QUESTIONS);
  const targetQuestions = clampNumber_(source.targetQuestions, minQuestions, maxQuestions, CONFIG.DEFAULT_TARGET_QUESTIONS);
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
    words = clauseWords.length >= 5 && clauseWords.length <= CONFIG.MAX_QUESTION_WORDS ? clauseWords : words.slice(0, CONFIG.MAX_QUESTION_WORDS);
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
    stageLabel: cleanText_(value.stageLabel, 100) || STAGE_LABELS[stage] || stage,
    focusKey: cleanText_(value.focusKey, 120) || stage,
    planId: cleanText_(value.planId, 120),
    isFollowUp: Boolean(value.isFollowUp),
    transition: cleanText_(value.transition, 220)
  };
}

function normaliseEvaluation_(value) {
  value = value || {};
  value.scores = value.scores || {};
  ['relevance', 'structure', 'specificity', 'clarity', 'roleKnowledge'].forEach(function(key) {
    value.scores[key] = clampNumber_(value.scores[key], 1, 5, 3);
  });
  return {
    scores: value.scores,
    strengths: stringArray_(value.strengths, 5),
    improvements: stringArray_(value.improvements, 5),
    framework: cleanText_(value.framework, 80) || 'Direct',
    betterOpening: cleanText_(value.betterOpening, 1200),
    answerOutline: stringArray_(value.answerOutline, 7),
    answerEvidence: stringArray_(value.answerEvidence, 8),
    missingEvidence: stringArray_(value.missingEvidence, 8)
  };
}

function normaliseCoverage_(value) {
  value = value || {};
  return {
    coveredCompetencies: stringArray_(value.coveredCompetencies, 20),
    weakCompetencies: stringArray_(value.weakCompetencies, 20),
    remainingCompetencies: stringArray_(value.remainingCompetencies, 20)
  };
}

function normaliseClaim_(value) {
  value = value || {};
  const allowed = ['high', 'medium', 'low', 'not_demonstrated'];
  return {
    claim: cleanText_(value.claim, 600),
    support: cleanText_(value.support, 1200),
    confidence: allowed.indexOf(value.confidence) >= 0 ? value.confidence : 'low',
    missingDetail: cleanText_(value.missingDetail, 600),
    followUpRecommended: Boolean(value.followUpRecommended)
  };
}

function normaliseReportScores_(value) {
  value = value || {};
  const result = {};
  ['jdFit', 'evidence', 'structure', 'clarity', 'motivation'].forEach(function(key) {
    result[key] = clampNumber_(value[key], 1, 5, 3);
  });
  return result;
}

function normaliseChecklist_(value) {
  value = value || {};
  return {
    organisationResearch: stringArray_(value.organisationResearch, 8),
    jdRequirements: stringArray_(value.jdRequirements, 8),
    cvExamples: stringArray_(value.cvExamples, 8),
    missingEvidence: stringArray_(value.missingEvidence, 8),
    careerHistory: stringArray_(value.careerHistory, 5)
  };
}

function normaliseConfidenceMap_(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map(function(item) {
    item = item || {};
    return {
      area: cleanText_(item.area, 220),
      cvEvidence: cleanText_(item.cvEvidence, 40),
      interviewEvidence: cleanText_(item.interviewEvidence, 40),
      confidence: cleanText_(item.confidence, 20)
    };
  }).filter(function(item) { return item.area; });
}

function normaliseAnswerGuidance_(value, answerCount) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, answerCount).map(function(item) {
    item = item || {};
    return {
      number: clampNumber_(item.number, 1, answerCount, 1),
      betterOpening: cleanText_(item.betterOpening, 1200),
      answerOutline: stringArray_(item.answerOutline, 7),
      evidenceToAdd: stringArray_(item.evidenceToAdd, 6)
    };
  });
}

function compactHistory_(answers, limit) {
  return (answers || []).slice(Math.max(0, answers.length - limit)).map(function(answer, index) {
    return {
      number: answers.length - Math.min(answers.length, limit) + index + 1,
      stage: cleanText_(answer.stage, 80),
      focusKey: cleanText_(answer.focusKey, 120),
      planId: cleanText_(answer.planId, 120),
      question: cleanText_(answer.question, 500),
      competency: cleanText_(answer.competency, 180),
      isFollowUp: Boolean(answer.isFollowUp),
      transcript: cleanText_(answer.transcript, 3500)
    };
  });
}

function transitionForStage_(stage) {
  const transitions = {
    background: 'Thank you. Let us talk about your background.',
    behavioural: 'I would now like to ask some behavioural questions.',
    resume: 'Let us discuss specific points from your CV.',
    job_fit: 'I would now like to focus on the role requirements.',
    contribution: 'Let us consider what you would bring to the organisation.',
    career_clarification: 'I have one brief question about your career history.',
    closing: 'Finally, I have one closing question.'
  };
  return transitions[stage] || '';
}

function fallbackQuestion_(planItem, profile, blueprint) {
  const focus = planItem.focusName || 'this area';
  if (planItem.stage === 'introduction') return 'How would you introduce yourself for this role?';
  if (planItem.stage === 'background' && planItem.focusKey === 'current_scope') return 'What are your main responsibilities in your current role?';
  if (planItem.stage === 'background') return 'How has your career developed towards this role?';
  if (planItem.stage === 'behavioural') return 'Tell me about a time you demonstrated ' + focus + '?';
  if (planItem.stage === 'resume') return 'What was your personal contribution to ' + focus + '?';
  if (planItem.stage === 'job_fit') return 'What experience do you have with ' + focus + '?';
  if (planItem.stage === 'contribution') return profile.organisation ? 'How would you add value to ' + profile.organisation + '?' : 'How would you add value to this team?';
  if (planItem.stage === 'career_clarification') {
    const type = blueprint.careerSignals && blueprint.careerSignals.type;
    if (type === 'employment_gap') return 'Could you briefly explain the gap in your employment history?';
    if (type === 'frequent_moves') return 'What influenced your recent job changes?';
    if (type === 'career_change') return 'What motivated your career change?';
    return 'Could you briefly explain this part of your career history?';
  }
  return 'Why is this role the right next step for you?';
}

function fallbackFollowUp_(claim) {
  if (claim && claim.missingDetail) return 'What was the outcome of that example?';
  return 'What did you personally do in that situation?';
}

function categoryForStage_(stage) {
  const map = {
    introduction: 'introduction', background: 'background', behavioural: 'behavioural', resume: 'resume',
    job_fit: 'role-fit', contribution: 'contribution', career_clarification: 'career-history', closing: 'closing'
  };
  return map[stage] || 'role-fit';
}

function isQuestion_(value) {
  return Boolean(value && typeof value.question === 'string' && value.question.trim().length > 5);
}

function stringArray_(value, max) {
  if (!Array.isArray(value)) return [];
  return value.map(function(item) { return cleanText_(item, 1200); }).filter(Boolean).slice(0, max);
}

function numberArray_(value, maxValue, maxItems) {
  if (!Array.isArray(value)) return [];
  const seen = {};
  return value.map(Number).filter(function(number) {
    return isFinite(number) && number >= 1 && number <= maxValue && !seen[number] && (seen[number] = true);
  }).slice(0, maxItems);
}

function slug_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
}

function clampNumber_(value, min, max, fallback) {
  const number = Number(value);
  if (!isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function logSession_(status, targetRole, questionCount, score, roleFamily) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) return;
  try {
    const ss = SpreadsheetApp.openById(id);
    let sheet = ss.getSheetByName('Sessions');
    if (!sheet) sheet = ss.insertSheet('Sessions');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Session ID', 'Status', 'Target Role', 'Role Family', 'Questions', 'Overall Score', 'Prompt Version']);
    }
    sheet.appendRow([new Date(), Utilities.getUuid(), status, targetRole, roleFamily || '', questionCount, score, CONFIG.PROMPT_VERSION]);
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
  try { parsed = JSON.parse(text); } catch (_) { throw new Error(label + ' returned non-JSON data (HTTP ' + code + ').'); }
  if (code < 200 || code >= 300) {
    throw new Error(label + ' error: ' + (parsed.error && parsed.error.message ? parsed.error.message : text.slice(0, 500)));
  }
  return parsed;
}

function parseJsonText_(text) {
  if (!text) throw new Error('AI returned an empty response.');
  const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('AI returned invalid JSON.');
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
