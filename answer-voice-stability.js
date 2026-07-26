(() => {
  const MIN_AUTO_SUBMIT_MS = 8000;
  const THINKING_PAUSE_MS = 5500;
  const LONG_ANSWER_PAUSE_MS = 6500;
  const LONG_ANSWER_AFTER_MS = 45000;
  const NO_SPEECH_RETRY_MS = 18000;
  const MAX_LONG_ANSWER_MS = 180000;
  const MIN_SPEECH_THRESHOLD = 0.008;
  const MAX_SPEECH_THRESHOLD = 0.028;
  const GEMINI_TTS_ATTEMPTS = 4;

  function adaptiveThreshold(recorder, rms) {
    if (!Number.isFinite(recorder._noiseFloor)) recorder._noiseFloor = 0.006;

    // Learn the room noise only from quieter samples. This prevents a loud
    // first word from being treated as background noise.
    if (rms < 0.025 && !recorder._hasSpeech) {
      recorder._noiseFloor = recorder._noiseFloor * 0.92 + rms * 0.08;
    } else if (rms < recorder._noiseFloor * 1.6) {
      recorder._noiseFloor = recorder._noiseFloor * 0.985 + rms * 0.015;
    }

    return Math.min(
      MAX_SPEECH_THRESHOLD,
      Math.max(MIN_SPEECH_THRESHOLD, recorder._noiseFloor * 2.7)
    );
  }

  monitorSilence = function monitorSilenceWithThinkingPauses(flow, recorder) {
    clearInterval(state.silenceTimer);
    recorder._continuousSpeechFrames = 0;

    state.silenceTimer = setInterval(() => {
      if (!isFlowActive(flow) || !state.analyser || recorder.state !== 'recording') return;

      state.analyser.getFloatTimeDomainData(state.analyserData);
      let sum = 0;
      for (const sample of state.analyserData) sum += sample * sample;
      const rms = Math.sqrt(sum / state.analyserData.length);
      updateListeningWave(rms);

      const now = Date.now();
      const elapsed = now - recorder._answerStartedAt;
      const threshold = adaptiveThreshold(recorder, rms);

      if (rms > threshold) {
        recorder._continuousSpeechFrames += 1;
        if (recorder._continuousSpeechFrames >= 2) {
          recorder._hasSpeech = true;
          recorder._lastSpeechAt = now;
        }
      } else {
        recorder._continuousSpeechFrames = 0;
      }

      const silenceAllowed = elapsed >= LONG_ANSWER_AFTER_MS
        ? LONG_ANSWER_PAUSE_MS
        : THINKING_PAUSE_MS;

      if (
        recorder._hasSpeech &&
        elapsed >= MIN_AUTO_SUBMIT_MS &&
        now - recorder._lastSpeechAt >= silenceAllowed
      ) {
        stopListening(recorder);
        return;
      }

      if (!recorder._hasSpeech && elapsed >= NO_SPEECH_RETRY_MS) {
        recorder._discard = true;
        stopListening(recorder, true);
        showToast('No answer was detected. The question will play again.');
        setTimeout(() => {
          if (isFlowActive(flow)) speakQuestion(state.currentQuestion.question);
        }, 700);
        return;
      }

      if (elapsed >= MAX_LONG_ANSWER_MS) stopListening(recorder);
    }, 120);
  };

  speakQuestion = async function speakQuestionWithStableVoice(text) {
    if (state.sessionStopped) return;

    const flow = ++state.flowVersion;
    cancelCurrentTurn(true);
    setStage('speaking', 'Listen to the question.');
    $('repeatQuestionButton').disabled = true;
    $('doneAnswerButton').disabled = true;

    let played = false;
    let lastError = null;

    for (let attempt = 1; attempt <= GEMINI_TTS_ATTEMPTS; attempt += 1) {
      if (!isFlowActive(flow)) return;

      try {
        const result = await callApi('synthesiseSpeech', { text });
        if (!isFlowActive(flow)) return;
        await playPcmAudio(result.audioBase64, Number(result.sampleRate || 24000), flow);
        played = true;
        break;
      } catch (error) {
        if (!isFlowActive(flow) || isCancellation(error)) return;
        lastError = error;
        console.warn(`Gemini voice attempt ${attempt} failed.`, error);
        if (attempt < GEMINI_TTS_ATTEMPTS) {
          setStage('processing', 'Preparing the interviewer voice...');
          await wait(450 * attempt);
        }
      }
    }

    if (!played) {
      console.error('Gemini voice could not be generated.', lastError);
      showToast('The interviewer voice is temporarily unavailable. Select Hear again to retry.', 6000);
      setStage('preparing', 'Select Hear again to retry the question.');
      $('repeatQuestionButton').disabled = false;
      $('doneAnswerButton').disabled = true;
      return;
    }

    if (!isFlowActive(flow)) return;
    await wait(380);
    if (!isFlowActive(flow)) return;
    await startListening(flow);
  };
})();
