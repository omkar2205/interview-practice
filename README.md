# Interview Practice

A personalised spoken mock-interview tool built from the candidate's CV and a target job description.

## Candidate journey

1. Upload a CV in PDF, DOCX or TXT format.
2. Upload or paste the job description.
3. Complete an automatic spoken interview.
4. Review a detailed preparation pack.
5. Re-practise weaker answers or download the PDF.

No camera, account creation, survey or typed interview response is required.

## Interview design

The backend creates the complete interview plan before the first question. It follows a standard sequence while adapting the focus to the role:

1. Introduction
2. Background
3. Behavioural questions
4. Different CV evidence areas
5. Different job-description requirements
6. Contribution to the company
7. Career-history clarification, only when clearly supported by the CV
8. Closing motivation

The role is classified into a conservative template such as graduate, technical, operations, sales, people manager or senior leadership. The template changes the weighting of behavioural, CV and role-fit questions without changing the overall sequence.

## AI task split

- **Gemini**: CV/JD analysis, evidence map, interview plan, role classification, core question writing, question validation retry, consistent TTS voice and final preparation pack.
- **Groq**: audio transcription, answer scoring, evidence extraction, claim ledger and follow-up recommendation.
- **Backend controller**: section order, topic rotation, follow-up limits, duplicate-question blocking and final decision on what happens next.

## Question controls

- One idea per question.
- Six to twenty words.
- Maximum one follow-up per section and three in the full interview.
- Distinct CV evidence and JD requirements are reserved before the interview begins.
- Questions are checked for repeated wording, filler and multi-part structure.
- Section transitions are spoken only when moving to a new part of the interview.

## Voice experience

- Gemini TTS uses one named interviewer voice throughout.
- Question audio is cached, so **Hear again** replays the exact same clip.
- Listening starts automatically after the question.
- Thinking pauses are allowed; **I'm done** remains available for long answers.
- The interview can be paused and resumed.
- Question captions can be shown or hidden.
- Interviewer volume can be adjusted.

## Preparation pack

The report includes:

- weighted readiness score
- JD fit, evidence, structure, clarity and motivation scores
- strengths and priority improvements
- organisation and JD research checklist
- CV examples and missing outcomes to prepare
- likely real-interview questions
- questions the candidate could ask the interviewer
- evidence-confidence table
- question-by-question answer outlines
- focused re-practice for individual answers

The overall score is weighted as follows:

- JD fit: 30%
- Evidence and examples: 25%
- Answer structure: 20%
- Clarity: 15%
- Motivation and contribution: 10%

## Repository structure

- `index.html`, `styles.css`, `app.js`: GitHub Pages frontend.
- `config.js`: Apps Script Web App URL and interview limits.
- `backend/Code.gs`: Google Apps Script backend.

## Required Apps Script properties

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `SPREADSHEET_ID`

## Deploying backend changes

GitHub changes to `backend/Code.gs` do not automatically update the Apps Script Web App.

1. Copy the complete current `backend/Code.gs` into the Apps Script project's `Code.gs`.
2. Save the Apps Script project.
3. Select **Deploy > Manage deployments**.
4. Edit the existing Web App deployment.
5. Select **New version**, then deploy.
6. Keep the existing `/exec` URL in `config.js`.

The `/exec` URL should return `version: "4.0-planned-interview"` after the deployment.

## Privacy

CV/JD text is extracted in the browser and sent to the configured Apps Script backend. Microphone audio is sent to Groq for transcription. Candidates should only process documents they are authorised to use and should review generated feedback for accuracy.
