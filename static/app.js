// Automated Resume Screening - Client App Logic with Interactive Voice AI

let currentTab = 'text';
let uploadedFiles = [];
let presetsData = [];
let currentRankedResults = [];

// Voice Recording State
let isRecording = false;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let recordedBuffers = [];
let recordingStartTime = null;
let recordingTimerInterval = null;
let speechRecognitionInstance = null;
let liveSpeechTranscript = '';

document.addEventListener('DOMContentLoaded', async () => {
  // Fetch presets
  try {
    const res = await fetch('/api/presets');
    if (res.ok) {
      presetsData = await res.json();
      loadPreset('data-engineer');
    }
  } catch (e) {
    console.error('Failed to load presets:', e);
    addCandidateRow('Candidate 1', '');
    addCandidateRow('Candidate 2', '');
  }

  setupDropzone();
  setupAudioPlayerEvents();
});

function switchCandidateTab(tab) {
  currentTab = tab;
  document.getElementById('tabTextBtn').classList.toggle('active', tab === 'text');
  document.getElementById('tabUploadBtn').classList.toggle('active', tab === 'upload');
  document.getElementById('tabTextContent').classList.toggle('active', tab === 'text');
  document.getElementById('tabUploadContent').classList.toggle('active', tab === 'upload');
}

function addCandidateRow(name = '', text = '') {
  const container = document.getElementById('candidatesList');
  const index = container.children.length + 1;
  const row = document.createElement('div');
  row.className = 'candidate-row';
  row.innerHTML = `
    <div class="candidate-row-header">
      <input type="text" class="candidate-name-input" placeholder="Candidate Name (e.g. Sarah)" value="${escapeHtml(name || `Candidate ${index}`)}">
      <div style="display:flex; align-items:center; gap:6px;">
        <button type="button" class="btn-dictate-mini" onclick="dictateCandidateRow(this)" title="Dictate Resume Text">🎙️ Dictate</button>
        <button type="button" class="btn-remove-row" title="Remove Candidate" onclick="this.closest('.candidate-row').remove()">✕</button>
      </div>
    </div>
    <textarea class="candidate-text-area" rows="3" placeholder="Paste resume text or skills profile...">${escapeHtml(text)}</textarea>
  `;
  container.appendChild(row);
}

function clearAll() {
  document.getElementById('jobDescription').value = '';
  document.getElementById('candidatesList').innerHTML = '';
  uploadedFiles = [];
  renderFilesList();
  addCandidateRow('Candidate 1', '');
  addCandidateRow('Candidate 2', '');
  document.getElementById('resultsContainer').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
  currentRankedResults = [];
}

function loadPreset(presetId) {
  const preset = presetsData.find(p => p.id === presetId);
  if (!preset) return;

  document.getElementById('jobDescription').value = preset.job_desc;
  const container = document.getElementById('candidatesList');
  container.innerHTML = '';

  preset.candidates.forEach(c => {
    addCandidateRow(c.name, c.text);
  });

  switchCandidateTab('text');
}

// ============================================================================
// File Dropzone Logic (.pdf, .docx, .txt)
// ============================================================================
function setupDropzone() {
  const dropzone = document.getElementById('dropzone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    handleFiles(files);
  });
}

function handleFileSelect(e) {
  handleFiles(e.target.files);
}

function handleFiles(files) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!uploadedFiles.some(f => f.name === file.name)) {
      uploadedFiles.push(file);
    }
  }
  renderFilesList();
}

function renderFilesList() {
  const container = document.getElementById('selectedFilesList');
  if (!container) return;

  if (uploadedFiles.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = uploadedFiles.map((file, idx) => `
    <div class="file-item">
      <span class="file-name">📄 ${escapeHtml(file.name)} (${(file.size / 1024).toFixed(1)} KB)</span>
      <button type="button" class="btn-remove-row" onclick="removeFile(${idx})">✕</button>
    </div>
  `).join('');
}

function removeFile(index) {
  uploadedFiles.splice(index, 1);
  renderFilesList();
}

// ============================================================================
// Screening Execution
// ============================================================================
async function runScreening() {
  const jobDesc = document.getElementById('jobDescription').value.trim();
  if (!jobDesc) {
    alert('Please enter a Job Description.');
    return;
  }

  const loading = document.getElementById('loadingState');
  const empty = document.getElementById('emptyState');
  const container = document.getElementById('resultsContainer');

  loading.style.display = 'block';
  empty.style.display = 'none';
  container.style.display = 'none';

  try {
    let response;

    if (currentTab === 'upload' && uploadedFiles.length > 0) {
      const formData = new FormData();
      formData.append('job_description', jobDesc);
      uploadedFiles.forEach(file => {
        formData.append('files[]', file);
      });
      response = await fetch('/api/screen', {
        method: 'POST',
        body: formData
      });
    } else {
      const candidateRows = document.querySelectorAll('.candidate-row');
      const candidates = [];
      candidateRows.forEach(row => {
        const nameInput = row.querySelector('.candidate-name-input');
        const textInput = row.querySelector('.candidate-text-area');
        const name = nameInput ? nameInput.value.trim() : '';
        const text = textInput ? textInput.value.trim() : '';
        if (name && text) {
          candidates.push({ name, text });
        }
      });

      if (candidates.length === 0) {
        alert('Please enter at least one candidate with a name and resume text.');
        loading.style.display = 'none';
        empty.style.display = 'block';
        return;
      }

      response = await fetch('/api/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_description: jobDesc,
          candidates: candidates
        })
      });
    }

    const data = await response.json();
    loading.style.display = 'none';

    if (!response.ok) {
      alert(data.error || 'Failed to screen resumes.');
      empty.style.display = 'block';
      return;
    }

    displayResults(data);

  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    alert('Network error: ' + err.message);
  }
}

function displayResults(data) {
  const empty = document.getElementById('emptyState');
  const container = document.getElementById('resultsContainer');
  const rankList = document.getElementById('rankList');

  empty.style.display = 'none';
  container.style.display = 'block';

  currentRankedResults = data.ranked || [];

  // Winner banner
  const top = currentRankedResults[0];
  if (top) {
    document.getElementById('winnerName').textContent = top.name;
    document.getElementById('winnerScore').textContent = `${top.score_percent} Match Score`;
  }

  // Render cards
  rankList.innerHTML = currentRankedResults.map((c, i) => {
    const isFirst = i === 0;
    const progressWidth = Math.min(100, Math.max(5, c.score * 100));

    const matchedChips = (c.matched_keywords && c.matched_keywords.length)
      ? c.matched_keywords.map(k => `<span class="chip matched">✓ ${escapeHtml(k)}</span>`).join('')
      : '<span class="chip">None</span>';

    const missingChips = (c.missing_keywords && c.missing_keywords.length)
      ? c.missing_keywords.map(k => `<span class="chip missing">✗ ${escapeHtml(k)}</span>`).join('')
      : '<span class="chip">None</span>';

    const negatedChips = (c.negated_keywords && c.negated_keywords.length)
      ? c.negated_keywords.map(k => `<span class="chip negated">⚠️ Negated: ${escapeHtml(k)}</span>`).join('')
      : '';

    return `
      <div class="rank-card ${isFirst ? 'rank-1' : ''}">
        <div class="rank-card-header">
          <div class="rank-badge-wrap">
            <span class="rank-position">#${c.rank}</span>
            <span class="rank-name">${escapeHtml(c.name)}</span>
          </div>
          <span class="tier-badge ${c.tier}">${c.badge}</span>
        </div>

        <div class="score-progress-wrap">
          <div class="score-header">
            <span>Overall Recruitment Match Score</span>
            <span class="score-percentage">${c.score_percent}</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${progressWidth}%"></div>
          </div>
          <div class="sub-scores-row">
            <span class="sub-score-item">
              <span class="sub-score-label">🎯 Skills Match:</span>
              <strong class="sub-score-val">${c.skill_match_percent || c.score_percent}</strong>
              <span class="sub-score-detail">(${c.skills_ratio || ''})</span>
            </span>
            <span class="sub-score-item">
              <span class="sub-score-label">📄 Context Relevance:</span>
              <strong class="sub-score-val">${c.context_match_percent || c.score_percent}</strong>
            </span>
          </div>
        </div>

        <div class="keywords-section">
          ${c.negated_keywords && c.negated_keywords.length ? `
          <div class="chip-row">
            <span class="chip-label" style="color: #fb7185;">Penalized:</span>
            ${negatedChips}
          </div>` : ''}
          <div class="chip-row">
            <span class="chip-label">Matched:</span>
            ${matchedChips}
          </div>
          <div class="chip-row">
            <span class="chip-label">Missing:</span>
            ${missingChips}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Interactive Voice Recording & Voice AI Pipeline
// ============================================================================

async function toggleVoiceRecording() {
  if (!isRecording) {
    await startVoiceRecording();
  } else {
    await stopVoiceRecordingAndSend();
  }
}

async function startVoiceRecording() {
  try {
    // Request microphone access
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Setup Web Audio API for PCM WAV capture
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    
    // ScriptProcessor for raw Float32 mono samples
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    recordedBuffers = [];

    scriptProcessor.onaudioprocess = (e) => {
      if (!isRecording) return;
      const inputData = e.inputBuffer.getChannelData(0);
      recordedBuffers.push(new Float32Array(inputData));
    };

    sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    // Optional: Start Web Speech API transcription in parallel for instant client feedback
    liveSpeechTranscript = '';
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        speechRecognitionInstance = new SpeechRec();
        const selectedLang = document.getElementById('voiceLangSelect').value;
        speechRecognitionInstance.lang = selectedLang === 'ar' ? 'ar-EG' : (selectedLang === 'en' ? 'en-US' : 'en-US');
        speechRecognitionInstance.continuous = true;
        speechRecognitionInstance.interimResults = true;
        speechRecognitionInstance.onresult = (evt) => {
          let text = '';
          for (let i = 0; i < evt.results.length; ++i) {
            text += evt.results[i][0].transcript;
          }
          liveSpeechTranscript = text;
          if (text) {
            document.getElementById('recordingStatusText').textContent = `Hearing: "${text}"`;
          }
        };
        speechRecognitionInstance.start();
      } catch (err) {
        console.warn('SpeechRecognition initialization note:', err);
      }
    }

    // UI Updates
    isRecording = true;
    recordingStartTime = Date.now();
    
    const recordBtn = document.getElementById('btnVoiceRecord');
    recordBtn.classList.add('recording');
    document.getElementById('voiceMicIcon').textContent = '⏹️';
    document.getElementById('voiceRecordText').textContent = 'Stop & Send Recording / إنهاء وإرسال';
    document.getElementById('voiceTimer').style.display = 'inline-block';
    document.getElementById('recordingVisualizer').style.display = 'flex';
    document.getElementById('recordingStatusText').textContent = 'Recording your voice... Speak now!';

    // Timer interval
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      document.getElementById('voiceTimer').textContent = `${mins}:${secs}`;
    }, 500);

  } catch (err) {
    console.error('Microphone access failed:', err);
    alert('Microphone access denied or unavailable: ' + err.message + '\nYou can also upload an audio file using the "Upload Voice Record" button.');
  }
}

async function stopVoiceRecordingAndSend() {
  if (!isRecording) return;
  isRecording = false;

  // Clear timer
  clearInterval(recordingTimerInterval);

  // Stop Web Speech if active
  if (speechRecognitionInstance) {
    try { speechRecognitionInstance.stop(); } catch (e) {}
  }

  // Disconnect Audio Nodes
  if (scriptProcessor) scriptProcessor.disconnect();
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }

  // Reset Record Button UI
  const recordBtn = document.getElementById('btnVoiceRecord');
  recordBtn.classList.remove('recording');
  document.getElementById('voiceMicIcon').textContent = '🎙️';
  document.getElementById('voiceRecordText').textContent = 'Start Voice Recording / تسجيل صوتي';
  document.getElementById('voiceTimer').style.display = 'none';
  document.getElementById('recordingVisualizer').style.display = 'none';

  // Merge audio buffers into a single PCM Float32Array
  let totalLength = 0;
  for (const b of recordedBuffers) totalLength += b.length;
  const mergedSamples = new Float32Array(totalLength);
  let offset = 0;
  for (const b of recordedBuffers) {
    mergedSamples.set(b, offset);
    offset += b.length;
  }

  const sampleRate = (audioContext && audioContext.sampleRate) ? audioContext.sampleRate : 16000;
  if (audioContext) {
    try { audioContext.close(); } catch (e) {}
  }

  // Encode to Standard 16-bit PCM WAV Blob
  const wavBlob = encodeWAV(mergedSamples, sampleRate);

  // Send to backend Voice Interaction endpoint
  await sendVoiceInteraction(wavBlob, liveSpeechTranscript);
}

// Standard 16-bit mono PCM WAV Encoder
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  
  // Format chunk identifier
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true);           // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true);           // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);  // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true);           // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true);          // BitsPerSample (16 bits)

  // Data chunk identifier
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Float32 to 16-bit PCM
  let index = 44;
  for (let i = 0; i < samples.length; i++, index += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Handle Uploading an Audio File
async function handleAudioUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  await sendVoiceInteraction(file, '');
  event.target.value = ''; // Reset input
}

// Send Voice Interaction to Backend
async function sendVoiceInteraction(audioBlobOrFile, fallbackText = '') {
  const convBox = document.getElementById('voiceConversationBox');
  const userText = document.getElementById('userTranscriptText');
  const aiText = document.getElementById('aiTranscriptText');
  const userPlayer = document.getElementById('userAudioPlayer');
  const actionTag = document.getElementById('voiceActionTag');

  convBox.style.display = 'flex';
  userText.textContent = fallbackText || 'Processing and transcribing your voice record...';
  aiText.textContent = 'Analyzing voice input and generating audio response...';
  actionTag.textContent = 'Processing...';

  // If user provided a local audio blob, show player
  if (audioBlobOrFile instanceof Blob) {
    userPlayer.src = URL.createObjectURL(audioBlobOrFile);
    userPlayer.style.display = 'block';
  } else {
    userPlayer.style.display = 'none';
  }

  // Gather current job description and candidates
  const jobDesc = document.getElementById('jobDescription').value.trim();
  const candidateRows = document.querySelectorAll('.candidate-row');
  const candidateNames = [];
  const candidateTexts = [];
  candidateRows.forEach(row => {
    const n = row.querySelector('.candidate-name-input')?.value.trim();
    const t = row.querySelector('.candidate-text-area')?.value.trim();
    if (n && t) {
      candidateNames.push(n);
      candidateTexts.push(t);
    }
  });

  const selectedLang = document.getElementById('voiceLangSelect').value;

  const formData = new FormData();
  if (audioBlobOrFile) {
    formData.append('audio', audioBlobOrFile, 'recording.wav');
  }
  if (fallbackText) {
    formData.append('fallback_text', fallbackText);
  }
  formData.append('language', selectedLang);
  formData.append('job_description', jobDesc);
  candidateNames.forEach(n => formData.append('candidate_names[]', n));
  candidateTexts.forEach(t => formData.append('candidate_texts[]', t));

  try {
    const res = await fetch('/api/voice/interact', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (!res.ok) {
      userText.textContent = fallbackText || 'Audio record processed.';
      aiText.textContent = data.error || 'Voice processing failed.';
      actionTag.textContent = 'Error';
      return;
    }

    // Update User Transcript Bubble
    userText.textContent = data.transcribed_text || fallbackText || '(Unrecognized speech)';

    // Update AI Voice Response Bubble
    aiText.textContent = data.response_text;
    actionTag.textContent = data.action ? data.action.toUpperCase() : 'VOICE REPLY';

    // Play Voice Response Audio
    if (data.audio_base64) {
      loadAiVoiceAudio(data.audio_base64);
    }

    // Execute Client-side Actions triggered by voice
    if (data.action === 'screen' && data.ranked) {
      displayResults(data);
    } else if (data.action === 'load_preset' && data.action_data?.preset_id) {
      loadPreset(data.action_data.preset_id);
    } else if (data.action === 'update_job' && data.action_data?.job_description) {
      document.getElementById('jobDescription').value = data.action_data.job_description;
    }

  } catch (err) {
    console.error('Voice interaction error:', err);
    aiText.textContent = 'Network error communicating with voice server: ' + err.message;
    actionTag.textContent = 'Connection Error';
  }
}

// Simulate Voice Query (Quick voice prompts)
async function simulateVoiceQuery(queryText) {
  const convBox = document.getElementById('voiceConversationBox');
  const userText = document.getElementById('userTranscriptText');
  const aiText = document.getElementById('aiTranscriptText');
  const userPlayer = document.getElementById('userAudioPlayer');

  convBox.style.display = 'flex';
  userPlayer.style.display = 'none';
  userText.textContent = `"${queryText}"`;
  aiText.textContent = 'Processing request and formulating voice reply...';

  await sendVoiceInteraction(null, queryText);
}

// Load and optionally Auto-play the AI Voice Audio Response
function loadAiVoiceAudio(audioDataUri) {
  const player = document.getElementById('aiAudioPlayer');
  player.src = audioDataUri;

  const autoPlay = document.getElementById('autoPlayVoiceToggle').checked;
  if (autoPlay) {
    player.play().catch(e => {
      console.log('Auto-play was prevented by browser policy (user gesture required):', e);
    });
  }
}

function setupAudioPlayerEvents() {
  const player = document.getElementById('aiAudioPlayer');
  const waveAnim = document.getElementById('aiWaveAnim');
  const playIcon = document.getElementById('playPauseIcon');
  const timeLabel = document.getElementById('aiAudioTime');

  if (!player) return;

  player.addEventListener('play', () => {
    waveAnim.classList.add('playing');
    playIcon.textContent = '⏸️';
  });

  player.addEventListener('pause', () => {
    waveAnim.classList.remove('playing');
    playIcon.textContent = '▶️';
  });

  player.addEventListener('ended', () => {
    waveAnim.classList.remove('playing');
    playIcon.textContent = '▶️';
  });

  player.addEventListener('timeupdate', () => {
    if (player.duration) {
      const cur = Math.floor(player.currentTime);
      const total = Math.floor(player.duration);
      timeLabel.textContent = `${cur}s / ${total}s`;
    }
  });
}

function togglePlayAiAudio() {
  const player = document.getElementById('aiAudioPlayer');
  if (!player.src) return;

  if (player.paused) {
    player.play();
  } else {
    player.pause();
  }
}

function replayAiAudio() {
  const player = document.getElementById('aiAudioPlayer');
  if (!player.src) return;
  player.currentTime = 0;
  player.play();
}

// ============================================================================
// Mini Dictation on Specific Text Fields
// ============================================================================
let activeDictationTarget = null;
let dictationRecognition = null;

function dictateField(targetId) {
  const textarea = document.getElementById(targetId);
  const btn = document.getElementById('btnDictateJob');
  handleFieldDictation(textarea, btn);
}

function dictateCandidateRow(buttonElement) {
  const row = buttonElement.closest('.candidate-row');
  const textarea = row.querySelector('.candidate-text-area');
  handleFieldDictation(textarea, buttonElement);
}

function handleFieldDictation(textareaElement, buttonElement) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    alert('Voice recognition in field requires a modern browser supporting Web Speech API (Chrome/Edge/Safari), or use the main Voice Screener at the top.');
    return;
  }

  if (activeDictationTarget === textareaElement && dictationRecognition) {
    // Stop dictation
    dictationRecognition.stop();
    activeDictationTarget = null;
    buttonElement.classList.remove('dictating');
    buttonElement.textContent = '🎙️ Dictate';
    return;
  }

  try {
    dictationRecognition = new SpeechRec();
    const selectedLang = document.getElementById('voiceLangSelect').value;
    dictationRecognition.lang = selectedLang === 'ar' ? 'ar-EG' : (selectedLang === 'en' ? 'en-US' : 'en-US');
    dictationRecognition.continuous = false;
    dictationRecognition.interimResults = false;

    buttonElement.classList.add('dictating');
    buttonElement.textContent = '🔴 Listening...';
    activeDictationTarget = textareaElement;

    dictationRecognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const current = textareaElement.value.trim();
      textareaElement.value = current ? `${current} ${transcript}` : transcript;
    };

    dictationRecognition.onend = () => {
      buttonElement.classList.remove('dictating');
      buttonElement.textContent = '🎙️ Dictate';
      activeDictationTarget = null;
    };

    dictationRecognition.onerror = (e) => {
      console.warn('Dictation error:', e);
      buttonElement.classList.remove('dictating');
      buttonElement.textContent = '🎙️ Dictate';
      activeDictationTarget = null;
    };

    dictationRecognition.start();

  } catch (err) {
    console.error('Dictation setup failed:', err);
    buttonElement.classList.remove('dictating');
    buttonElement.textContent = '🎙️ Dictate';
  }
}

// Speak the winner candidate review using TTS
async function speakCurrentWinner() {
  if (!currentRankedResults || currentRankedResults.length === 0) {
    alert('Please screen resumes first to review the top candidate.');
    return;
  }

  const top = currentRankedResults[0];
  const skills = (top.matched_keywords && top.matched_keywords.length)
    ? top.matched_keywords.slice(0, 4).join(', ')
    : 'core job requirements';

  const selectedLang = document.getElementById('voiceLangSelect').value;
  const isAr = selectedLang === 'ar';

  const textToSpeak = isAr
    ? `أفضل مرشح هو ${top.name} بنسبة توافق ${top.score_percent}. من أهم مهاراته المطابقة: ${skills}.`
    : `The top ranked candidate is ${top.name} with an overall match score of ${top.score_percent}. Top matching skills include: ${skills}.`;

  try {
    const res = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: textToSpeak,
        language: isAr ? 'ar' : 'en'
      })
    });
    const data = await res.json();
    if (data.audio_base64) {
      loadAiVoiceAudio(data.audio_base64);
      // Show in AI bubble
      const convBox = document.getElementById('voiceConversationBox');
      const aiText = document.getElementById('aiTranscriptText');
      const actionTag = document.getElementById('voiceActionTag');
      convBox.style.display = 'flex';
      aiText.textContent = textToSpeak;
      actionTag.textContent = 'TOP CANDIDATE REVIEW';
    }
  } catch (err) {
    alert('Failed to generate speech for top candidate: ' + err.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
