# Interview Practice

A simple voice-only mock interview tool.

## Candidate journey

1. Upload a CV in PDF, DOCX or TXT format.
2. Upload or paste the job description.
3. Complete eight microphone-based interview questions.
4. Review detailed feedback.
5. Download a personalised PDF preparation sheet.

No camera, account creation or survey is required.

## AI task split

- **Gemini**: CV/JD understanding, candidate profile, interview plan and final report synthesis.
- **Groq**: microphone transcription and question-by-question answer coaching.

## Repository structure

- `index.html`, `styles.css`, `app.js`: GitHub Pages frontend.
- `config.js`: deployed Apps Script Web App URL.
- `backend/Code.gs`: Google Apps Script backend.

## Required Apps Script properties

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `SPREADSHEET_ID`

Deploy the Apps Script project as a Web App, then paste its `/exec` URL into `config.js`.

## Privacy

The frontend extracts CV and JD text in the browser and sends it to the configured Apps Script backend. Microphone audio is sent to Groq for transcription. Candidates should only process documents they are authorised to use and should review generated feedback for accuracy.