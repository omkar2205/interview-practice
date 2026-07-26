const $ = id => document.getElementById(id);
const state = { cvText:'', jdText:'', profile:null, plan:[], index:0, answers:[], mediaRecorder:null, chunks:[], report:null };

const screens = ['setupScreen','interviewScreen','reportScreen'];
function showScreen(id){ screens.forEach(s=>$(s).classList.toggle('active',s===id)); window.scrollTo({top:0,behavior:'smooth'}); }
function setBusy(on,text='Processing...'){ $('processingText').textContent=text; $('processingOverlay').classList.toggle('hidden',!on); }
function apiReady(){ return Boolean(window.APP_CONFIG?.API_URL); }
async function callApi(action,payload={}){
  if(!apiReady()) throw new Error('Backend URL has not been added to config.js.');
  const res = await fetch(window.APP_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})});
  const data = await res.json();
  if(!data.ok) throw new Error(data.error||'Backend request failed.');
  return data.data;
}

async function extractFile(file){
  const ext=file.name.split('.').pop().toLowerCase();
  if(ext==='txt') return await file.text();
  if(ext==='docx'){
    const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
    return result.value;
  }
  if(ext==='pdf'){
    const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
    const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
    let text='';
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p); const content=await page.getTextContent();
      text+=content.items.map(i=>i.str).join(' ')+'\n';
    }
    return text;
  }
  throw new Error('Unsupported file type.');
}

function validateSetup(){
  state.jdText=$('jdText').value.trim()||state.jdText;
  const good=state.cvText.trim().length>80&&state.jdText.trim().length>80;
  $('startButton').disabled=!good;
  $('setupMessage').textContent=good?'Ready to create your interview.':'Both a CV and job description are required.';
}

async function bindFile(inputId,nameId,target){
  const file=$(inputId).files[0]; if(!file)return;
  try{ $(nameId).textContent='Reading file...'; state[target]=await extractFile(file); $(nameId).textContent=file.name; if(target==='jdText')$('jdText').value=state.jdText; validateSetup(); }
  catch(e){ $(nameId).textContent=e.message; }
}

$('cvButton').onclick=()=>$('cvFile').click();
$('jdButton').onclick=()=>$('jdFile').click();
$('cvFile').onchange=()=>bindFile('cvFile','cvName','cvText');
$('jdFile').onchange=()=>bindFile('jdFile','jdName','jdText');
$('jdText').oninput=validateSetup;

async function initialise(){
  try{
    if(apiReady()){ await callApi('health'); $('connectionStatus').textContent='Backend connected'; }
  }catch{ $('connectionStatus').textContent='Backend connection failed'; }
}

$('startButton').onclick=async()=>{
  try{
    state.jdText=$('jdText').value.trim(); setBusy(true,'Reading your CV and preparing questions...');
    const result=await callApi('prepareInterview',{cvText:state.cvText,jdText:state.jdText,questionCount:window.APP_CONFIG.QUESTION_COUNT||8});
    state.profile=result.profile; state.plan=result.questions; state.index=0; state.answers=[];
    setBusy(false); showScreen('interviewScreen'); renderQuestion();
  }catch(e){setBusy(false);alert(e.message);}
};

function renderQuestion(){
  const q=state.plan[state.index];
  $('questionCounter').textContent=`Question ${state.index+1} of ${state.plan.length}`;
  $('questionText').textContent=q.question;
  $('transcriptText').value=''; $('submitTranscriptButton').disabled=true; $('retryButton').disabled=true;
  $('recordButton').disabled=false; $('stopButton').disabled=true;
  $('recordingLabel').textContent='Ready to answer'; $('recordingHelp').textContent='Select Start answer and speak naturally.';
  speak(q.question);
}
function speak(text){ if(!('speechSynthesis'in window))return; speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.rate=.96; u.pitch=1; speechSynthesis.speak(u); }

$('recordButton').onclick=async()=>{
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    state.chunks=[]; state.mediaRecorder=new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data)};
    state.mediaRecorder.onstop=()=>processAudio(stream);
    state.mediaRecorder.start(); $('recordButton').disabled=true; $('stopButton').disabled=false;
    $('micPulse').classList.add('live'); $('recordingLabel').textContent='Listening...'; $('recordingHelp').textContent='Answer at your own pace, then stop and submit.';
  }catch(e){alert('Microphone access is required. '+e.message);}
};
$('stopButton').onclick=()=>{ if(state.mediaRecorder?.state==='recording')state.mediaRecorder.stop(); };

async function processAudio(stream){
  stream.getTracks().forEach(t=>t.stop()); $('micPulse').classList.remove('live'); $('stopButton').disabled=true;
  try{
    setBusy(true,'Transcribing your response...'); const blob=new Blob(state.chunks,{type:state.mediaRecorder.mimeType});
    const audioBase64=await blobToBase64(blob);
    const result=await callApi('transcribe',{audioBase64,mimeType:blob.type});
    $('transcriptText').value=result.transcript||''; $('submitTranscriptButton').disabled=!result.transcript; $('retryButton').disabled=false;
    $('recordingLabel').textContent='Transcript ready'; $('recordingHelp').textContent='Edit it if needed, then use the transcript.';
  }catch(e){alert(e.message); $('recordButton').disabled=false;}finally{setBusy(false);}
}
function blobToBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});}
$('retryButton').onclick=renderQuestion;
$('submitTranscriptButton').onclick=submitCurrentAnswer;
async function submitCurrentAnswer(){
  const transcript=$('transcriptText').value.trim(); if(!transcript)return;
  try{
    setBusy(true,'Reviewing your answer...'); const q=state.plan[state.index];
    const evaluation=await callApi('evaluateAnswer',{profile:state.profile,jdText:state.jdText,question:q,transcript,previousAnswers:state.answers});
    state.answers.push({question:q.question,category:q.category,transcript,evaluation}); state.index++;
    if(state.index<state.plan.length){setBusy(false);renderQuestion();}
    else await finishInterview();
  }catch(e){setBusy(false);alert(e.message);}
}
async function finishInterview(){
  try{
    setBusy(true,'Creating your detailed preparation sheet...');
    state.report=await callApi('finaliseReport',{profile:state.profile,jdText:state.jdText,answers:state.answers});
    renderReport(); setBusy(false); showScreen('reportScreen');
  }catch(e){setBusy(false);alert(e.message);}
}
$('endEarlyButton').onclick=()=>{if(state.answers.length<2){alert('Complete at least two questions first.');return;}finishInterview();};

function list(items=[]){return `<ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`;}
function escapeHtml(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function renderReport(){
  const r=state.report; const scores=r.scores||{};
  $('reportContent').innerHTML=`
    <section class="report-card"><h3>Overall readiness</h3><div class="score-grid">
      <div class="score-item">Overall<strong>${scores.overall||0}%</strong></div>
      <div class="score-item">Relevance<strong>${scores.relevance||0}/5</strong></div>
      <div class="score-item">Structure<strong>${scores.structure||0}/5</strong></div>
      <div class="score-item">Examples<strong>${scores.examples||0}/5</strong></div>
      <div class="score-item">Clarity<strong>${scores.clarity||0}/5</strong></div>
    </div></section>
    <section class="report-card"><div class="feedback-columns"><div class="feedback-box"><h3>Strongest areas</h3>${list(r.strengths)}</div><div class="feedback-box"><h3>Priorities to improve</h3>${list(r.improvements)}</div></div></section>
    <section class="report-card"><h3>Your preparation plan</h3>${list(r.practicePlan)}</section>
    <section class="report-card"><h3>Question-by-question feedback</h3>${state.answers.map((a,i)=>`<div class="answer-review"><strong>${i+1}. ${escapeHtml(a.question)}</strong><p><b>Your response:</b> ${escapeHtml(a.transcript)}</p><p><b>What worked:</b> ${escapeHtml((a.evaluation.strengths||[]).join(' · '))}</p><p><b>Improve:</b> ${escapeHtml((a.evaluation.improvements||[]).join(' · '))}</p><p class="improved"><b>Better-framed response:</b><br>${escapeHtml(a.evaluation.improvedResponse||'')}</p></div>`).join('')}</section>`;
}

$('downloadPdfButton').onclick=()=>{
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:'mm',format:'a4'}); const margin=16,max=178; let y=18;
  const line=(text,size=10,bold=false)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);const parts=doc.splitTextToSize(String(text||''),max);if(y+parts.length*5>282){doc.addPage();y=18;}doc.text(parts,margin,y);y+=parts.length*5+3;};
  line('Interview Practice – Personal Preparation Sheet',18,true); line(`Target role: ${state.profile?.targetRole||'Not specified'}`,11); line(`Overall readiness: ${state.report.scores?.overall||0}%`,14,true);
  line('Strongest areas',13,true); (state.report.strengths||[]).forEach(x=>line('• '+x));
  line('Priorities to improve',13,true); (state.report.improvements||[]).forEach(x=>line('• '+x));
  line('Practice plan',13,true); (state.report.practicePlan||[]).forEach(x=>line('• '+x));
  state.answers.forEach((a,i)=>{line(`${i+1}. ${a.question}`,13,true);line('Your response: '+a.transcript);line('What worked: '+(a.evaluation.strengths||[]).join('; '));line('Improve: '+(a.evaluation.improvements||[]).join('; '));line('Better-framed response:',11,true);line(a.evaluation.improvedResponse||'');});
  doc.save('Interview-Practice-Preparation-Sheet.pdf');
};
$('restartButton').onclick=()=>location.reload();
initialise();