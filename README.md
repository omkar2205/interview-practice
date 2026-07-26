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
- The next short question is selected using the CV, job description and latest response.
- **Hear again** repeats the current question without submitting the partial answer.

## Dynamic interview policy

- Minimum: 8 completed questions.
- Normal target: around 12 questions.
- Maximum: 16 questions by default, with backend support for up to 20.
- Each question must contain one idea, use direct spoken English and remain under 20 words.
- The interviewer may ask one targeted follow-up when a response needs clearer evidence.
- Consecutive follow-ups on the same answer are prevented.

The limits can be changed in `config.js` using `MIN_QUESTIONS`, `TARGET_QUESTIONS` and `MAX_QUESTIONS`.

## AI task split

- **Gemini**: CV/JD understanding, competency blueprint, first question, natural TTS voice and final report synthesis.
- **Groq**: microphone transcription, answer-level coaching, competency coverage and selection of the next response-specific question.

## Repository structure

- `index.html`, `styles.css`, `app.js`: GitHub Pages frontend.
- `config.js`: Apps Script Web App URL and interview-length policy.
- `backend/Code.gs`: Google Apps Script backend.

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

Opening the `/exec` URL directly should return a JSON response containing `version: "3.0-voice-flow"` after deployment.

## Privacy

CV/JD text is extracted in the browser and sent to the configured Apps Script backend. Microphone audio is sent to Groq for transcription. Candidates should only process documents they are authorised to use and should review generated feedback for accuracy.
