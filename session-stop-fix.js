(() => {
  let sessionStopped = false;
  let finishStarted = false;

  const originalPresentQuestion = presentQuestion;
  const originalSpeakQuestion = speakQuestion;
  const originalPlayPcmAudio = playPcmAudio;
  const originalBrowserVoice = speakWithBrowserVoice;
  const originalStartListening = startListening;
  const originalProcessRecordedAnswer = processRecordedAnswer;
  const originalFinishInterview = finishInterview;

  function stopQuestionAudio() {
    const audio = $('questionAudio');
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute('src');
        audio.load();
      } catch (_) {}
    }

    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }

    if (state.questionAudioUrl) {
      try { URL.revokeObjectURL(state.questionAudioUrl); } catch (_) {}
      state.questionAudioUrl = null;
    }
  }

  function stopAllInterviewActivity() {
    sessionStopped = true;

    clearInterval(state.timerHandle);
    clearInterval(state.silenceTimer);
    clearTimeout(state.toastHandle);

    stopQuestionAudio();

    state.discardRecording = true;
    try { cancelListening(true); } catch (_) {}

    if (state.mediaRecorder?.state === 'recording') {
      try { state.mediaRecorder.stop(); } catch (_) {}
    }

    if (state.micStream) {
      state.micStream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
      state.micStream = null;
    }

    try { resetWaveBars(); } catch (_) {}
    $('repeatQuestionButton').disabled = true;
    $('doneAnswerButton').disabled = true;
    $('endEarlyButton').disabled = true;
  }

  presentQuestion = async function (...args) {
    if (sessionStopped) return;
    return originalPresentQuestion.apply(this, args);
  };

  speakQuestion = async function (...args) {
    if (sessionStopped) return;
    return originalSpeakQuestion.apply(this, args);
  };

  playPcmAudio = function (...args) {
    if (sessionStopped) return Promise.resolve();
    return originalPlayPcmAudio.apply(this, args);
  };

  speakWithBrowserVoice = function (...args) {
    if (sessionStopped) return Promise.resolve();
    return originalBrowserVoice.apply(this, args);
  };

  startListening = async function (...args) {
    if (sessionStopped) return;
    return originalStartListening.apply(this, args);
  };

  processRecordedAnswer = async function (...args) {
    if (sessionStopped) return;
    return originalProcessRecordedAnswer.apply(this, args);
  };

  finishInterview = async function (...args) {
    if (finishStarted) return;
    finishStarted = true;
    stopAllInterviewActivity();

    try {
      return await originalFinishInterview.apply(this, args);
    } catch (error) {
      finishStarted = false;
      throw error;
    }
  };

  $('endEarlyButton').onclick = () => {
    if (state.answers.length < 5 || finishStarted) return;
    if (!window.confirm('Finish now and create your preparation report?')) return;
    finishInterview();
  };

  window.addEventListener('beforeunload', stopAllInterviewActivity);
})();
