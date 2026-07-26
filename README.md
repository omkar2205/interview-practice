# Interview Practice

A personalised spoken mock interview tool based on the candidate's CV and a target job description.

## Candidate journey

1. Upload a CV in PDF, DOCX or TXT format.
2. Upload or paste the job description.
3. Complete an automatic spoken interview.
4. Review detailed feedback.
5. Download a personalised PDF preparation sheet.

No camera, account creation, survey or typed interview response is required.

## Interview flow

- Gemini TTS reads each question using a natural interviewer voice.
- The speaking waveform animates while the question is being read.
- Microphone listening starts automatically when the question ends.
- The response stops automatically after a natural pause, with an **I'm done** button as a fallback.
- Groq transcribes and privately evaluates the answer.
- **Hear again** repeats the current question without submitting the partial answer.
- Ending the interview immediately stops audio, recording and pending question flows.

## Structured interview sequence

1. Introduction: 1 question.
2. Background: 2 questions.
3. Behavioural: 3 different competencies.
4. CV discussion: 2 different CV areas.
5. Role fit: 2 different job-description requirements.
6. Contribution: 1 question about value to the organisation.
7. Career history: 1 neutral clarification only when a clear gap, career change or repeated short tenure is detected.
8. Closing: 1 question.

The interviewer can add up to three targeted follow-ups, with no more than one follow-up in the same section. Core questions are reserved so follow-ups cannot prevent later interview sections from being covered.

Questions use one idea, direct spoken English and a maximum of 20 words.

## AI task split

- **Gemini**: CV/JD understanding, structured blueprint, career-history signal detection, natural TTS voice and final report synthesis.
- **Groq**: microphone transcription, answer-level coaching and question wording within the section selected by the backend controller.

## Repository structure

- `index.html`, `styles.css`, `app.js`: GitHub Pages frontend.
- `config.js`: Apps Script Web App URL and interview-length limits.
- `backend/Code.gs`: Google Apps Script backend and interview-stage controller.

## Required Apps Script properties

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `SPREADSHEET_ID`

## Deploying backend changes

GitHub changes to `backend/Code.gs` do not automatically update the deployed Apps Script Web App.

1. Copy the complete current `backend/Code.gs` into the Apps Script project's `Code.gs`.
2. Save the Apps Script project.
3. Select **Deploy > Manage deployments**.
4. Edit the existing Web App deployment.
5. Select **New version**, then deploy.
6. Keep the existing `/exec` URL in `config.js`.

Opening the `/exec` URL directly should return a JSON response containing `version: "3.2-structured-interview"` after deployment.

## Privacy

CV/JD text is extracted in the browser and sent to the configured Apps Script backend. Microphone audio is sent to Groq for transcription. Candidates should only process documents they are authorised to use and should review generated feedback for accuracy.
