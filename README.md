# Interview Practice

A simple voice-only mock interview tool based on the candidate's CV and a target job description.

## Candidate journey

1. Upload a CV in PDF, DOCX or TXT format.
2. Upload or paste the job description.
3. Complete a dynamic microphone-based interview.
4. Review detailed feedback.
5. Download a personalised PDF preparation sheet.

No camera, account creation or survey is required.

## Dynamic interview policy

- Minimum: 8 completed questions.
- Normal target: around 12 questions.
- Maximum: 16 questions by default, with backend support for up to 20.
- Each next question is selected after reviewing the candidate's latest response.
- The interviewer may ask one targeted follow-up when an answer is vague, introduces an important claim or needs clearer evidence.
- The flow moves to another priority competency after a follow-up and avoids repeating earlier questions.

The values can be changed in `config.js` using `MIN_QUESTIONS`, `TARGET_QUESTIONS` and `MAX_QUESTIONS`.

## AI task split

- **Gemini**: CV/JD understanding, candidate profile, competency blueprint, first question and final report synthesis.
- **Groq**: microphone transcription, answer-level coaching, competency coverage and selection of the next response-specific question.

## Repository structure

- `index.html`, `styles.css`, `app.js`: GitHub Pages frontend.
- `config.js`: deployed Apps Script Web App URL and interview-length policy.
- `backend/Code.gs`: Google Apps Script backend.

## Required Apps Script properties

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `SPREADSHEET_ID`

## Deploying backend changes

Changes made to `backend/Code.gs` in GitHub do not automatically update the deployed Apps Script Web App.

1. Copy the complete current `backend/Code.gs` into the Apps Script project's `Code.gs`.
2. Save the Apps Script project.
3. Select **Deploy > Manage deployments**.
4. Edit the existing Web App deployment.
5. Select **New version**, then deploy.
6. Keep the existing `/exec` URL in `config.js`.

Opening the `/exec` URL directly should return a JSON response with `version: "2.0-dynamic"` after the new backend is deployed.

## Privacy

The frontend extracts CV and JD text in the browser and sends it to the configured Apps Script backend. Microphone audio is sent to Groq for transcription. Candidates should only process documents they are authorised to use and should review generated feedback for accuracy.
