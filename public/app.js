// Meeting Minutes Web App - Frontend JavaScript
// This handles all UI interactions and communication with the backend API

// Global state
let currentStep = 0; // Start at 0 for login screen
let selectedMicrophones = []; // Changed to array for multiple mics
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let audioContext = null;
let analyser = null;
let visualizerAnimation = null;
let transcriptionData = null;
let analysisData = null;
let summaryData = null;
let transcriptSegments = [];
let speakerAssignments = {};
let participants = [];
let audioStreams = []; // Store multiple streams
let isAuthenticated = false;
let currentUserEmail = null;
let recordingMimeType = 'audio/webm'; // Store the actual MIME type used
let audioFilePath = null; // Store audio file path for speaker extraction
let detectedSpeakers = []; // Speakers detected from introductions
let speakerSamples = []; // Audio samples for speaker identification

// API Base URL
const API_BASE = '';

// Step Management
function showStep(stepNumber) {
  // Hide all steps
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('active');
  });

  // Show the target step
  const targetStep = document.getElementById(`step-${getStepId(stepNumber)}`);
  if (targetStep) {
    targetStep.classList.add('active');
  }

  // Update step indicators
  document.querySelectorAll('.step-dot').forEach((dot, index) => {
    if (index < stepNumber) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });

  currentStep = stepNumber;
  updateNavigationButtons();
}

function getStepId(stepNumber) {
  const steps = ['login-screen', 'api', 'microphone', 'recording', 'processing', 'speakers', 'export'];
  return steps[stepNumber];
}

function updateNavigationButtons() {
  const prevBtn = document.getElementById('prev-step');
  const nextBtn = document.getElementById('next-step');

  prevBtn.disabled = currentStep === 1;
  // Next button is controlled by individual step logic
}

// Step 0: Login
async function checkAuthStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/status`);
    const data = await response.json();

    if (data.success && data.authenticated) {
      isAuthenticated = true;
      currentUserEmail = data.email;
      document.getElementById('login-user-info').textContent = `Logged in as: ${currentUserEmail}`;

      // Skip to API key step
      showStep(1);
      checkApiKeyStatus();
    }
  } catch (error) {
    console.error('Failed to check auth status:', error);
  }
}

// Login handler function
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    alert('Please enter email and password');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (data.success) {
      isAuthenticated = true;
      currentUserEmail = data.email;

      // Move to API key step
      showStep(1);

      // If user has API key, check and possibly skip to microphone
      if (data.hasApiKey) {
        checkApiKeyStatus();
      }
    } else {
      alert(`Login failed: ${data.error}`);
    }
  } catch (error) {
    alert(`Login error: ${error.message}`);
  }
}

// Login button click
document.getElementById('login-btn').addEventListener('click', handleLogin);

// Email field: Enter key moves to password field
document.getElementById('login-email').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('login-password').focus();
  }
});

// Password field: Enter key triggers login
document.getElementById('login-password').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleLogin();
  }
});

// Step 1: API Key Setup
async function checkApiKeyStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/check-config`);
    const data = await response.json();

    if (data.success && data.hasApiKey) {
      // API key is already configured, show status
      document.getElementById('api-key-status').style.display = 'block';
      document.getElementById('api-key-form').style.display = 'none';
      document.getElementById('continue-with-api').style.display = 'inline-block';
    } else {
      // No API key, show the form
      document.getElementById('api-key-status').style.display = 'none';
      document.getElementById('api-key-form').style.display = 'block';
      document.getElementById('continue-with-api').style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to check API key status:', error);
    // If check fails, just show the normal form
  }
}

document.getElementById('save-api-key').addEventListener('click', async () => {
  const apiKey = document.getElementById('api-key').value.trim();
  const rememberKey = document.getElementById('remember-key').checked;

  if (!apiKey) {
    alert('Please enter your OpenAI API key');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/init-openai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, saveKey: rememberKey })
    });

    const data = await response.json();

    if (data.success) {
      if (data.saved) {
        alert('API key validated and saved successfully! You won\'t need to enter it again.');
      } else {
        alert('API key validated successfully!');
      }
      showStep(2);
      loadMicrophones();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    alert(`Failed to validate API key: ${error.message}`);
  }
});

document.getElementById('change-api-key').addEventListener('click', () => {
  document.getElementById('api-key-status').style.display = 'none';
  document.getElementById('api-key-form').style.display = 'block';
  document.getElementById('continue-with-api').style.display = 'none';
  document.getElementById('api-key').value = '';
  document.getElementById('api-key').focus();
});

document.getElementById('continue-with-api')?.addEventListener('click', () => {
  // Continue to microphone selection with existing API key
  showStep(2);
  loadMicrophones();
});

// Step 2: Microphone Selection
async function loadMicrophones() {
  try {
    // Request permission first to get proper device labels
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(track => track.stop());

    // Now enumerate devices with proper labels
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');

    const microphoneList = document.getElementById('microphone-list');
    microphoneList.innerHTML = '';

    if (audioInputs.length === 0) {
      microphoneList.innerHTML = '<p class="info-text">No microphones detected. Please connect a microphone and refresh.</p>';
      return;
    }

    // Add instruction text
    const instructionText = document.createElement('p');
    instructionText.className = 'info-text';
    instructionText.textContent = 'Select one or more microphones to record from:';
    microphoneList.appendChild(instructionText);

    audioInputs.forEach((device, index) => {
      const micOption = document.createElement('div');
      micOption.className = 'microphone-option';
      micOption.innerHTML = `
        <input type="checkbox" id="mic-${index}" class="mic-checkbox" value="${device.deviceId}">
        <label for="mic-${index}">${device.label || `Microphone ${index + 1}`}</label>
      `;
      microphoneList.appendChild(micOption);

      // Handle checkbox change
      const checkbox = micOption.querySelector(`#mic-${index}`);
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          if (!selectedMicrophones.includes(device.deviceId)) {
            selectedMicrophones.push(device.deviceId);
          }
        } else {
          selectedMicrophones = selectedMicrophones.filter(id => id !== device.deviceId);
        }
        console.log('Selected microphones:', selectedMicrophones);
      });
    });

    // Auto-select first microphone
    if (audioInputs.length > 0) {
      document.getElementById('mic-0').checked = true;
      selectedMicrophones = [audioInputs[0].deviceId];
    }
  } catch (error) {
    console.error('Error loading microphones:', error);
    alert('Failed to access microphones. Please grant microphone permissions.');
  }
}

document.getElementById('next-to-recording').addEventListener('click', () => {
  if (selectedMicrophones.length === 0) {
    alert('Please select at least one microphone');
    return;
  }
  showStep(3);
});

// Step 3: Recording
document.getElementById('start-recording').addEventListener('click', startRecording);
document.getElementById('stop-recording').addEventListener('click', stopRecording);

async function startRecording() {
  try {
    // Get streams from all selected microphones
    audioStreams = [];
    for (const deviceId of selectedMicrophones) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      audioStreams.push(stream);
    }

    // Setup audio context and mixer
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    // Mix all microphone streams together
    audioStreams.forEach(stream => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
      source.connect(analyser); // Connect to analyser for visualization
    });

    // Start visualization
    startAudioVisualization();

    // Setup recording with the mixed stream
    const mixedStream = destination.stream;

    // Try to use the best supported format
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
      console.warn('Opus codec not supported, falling back to default webm');
    }

    recordingMimeType = mimeType; // Store for later use
    mediaRecorder = new MediaRecorder(mixedStream, { mimeType });
    audioChunks = [];

    console.log('Recording with MIME type:', mimeType);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = handleRecordingComplete;

    mediaRecorder.start();
    recordingStartTime = Date.now();

    // Update UI
    document.getElementById('start-recording').disabled = true;
    document.getElementById('stop-recording').disabled = false;
    document.getElementById('recording-indicator').classList.add('recording');

    // Start timer
    updateRecordingTimer();
    recordingTimer = setInterval(updateRecordingTimer, 1000);

    console.log(`Recording started with ${selectedMicrophones.length} microphone(s)`);

  } catch (error) {
    console.error('Error starting recording:', error);
    alert('Failed to start recording. Please check microphone permissions.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    clearInterval(recordingTimer);

    // Stop all tracks from all streams
    audioStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });

    // Stop visualization
    cancelAnimationFrame(visualizerAnimation);
    if (audioContext) {
      audioContext.close();
    }

    // Update UI
    document.getElementById('start-recording').disabled = false;
    document.getElementById('stop-recording').disabled = true;
    document.getElementById('recording-indicator').classList.remove('recording');

    console.log('Recording stopped');
  }
}

function updateRecordingTimer() {
  const elapsed = Date.now() - recordingStartTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  document.getElementById('recording-time').textContent =
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startAudioVisualization() {
  const canvas = document.getElementById('audio-visualizer');
  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    visualizerAnimation = requestAnimationFrame(draw);

    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * canvas.height / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }

  draw();
}

async function handleRecordingComplete() {
  // Move to processing step
  showStep(4);

  // Show processing status
  document.getElementById('progress-text').textContent = 'Uploading audio...';
  document.getElementById('progress-bar').style.width = '10%';

  try {
    // Create audio blob with the actual recording MIME type
    const audioBlob = new Blob(audioChunks, { type: recordingMimeType });

    // Determine file extension based on MIME type
    const extension = recordingMimeType.includes('opus') ? 'opus' : 'webm';

    // Create form data
    const formData = new FormData();
    formData.append('audio', audioBlob, `recording.${extension}`);

    // Upload and transcribe
    document.getElementById('progress-text').textContent = 'Transcribing audio...';
    document.getElementById('progress-bar').style.width = '30%';

    const transcribeResponse = await fetch(`${API_BASE}/api/transcribe`, {
      method: 'POST',
      body: formData
    });

    const transcribeData = await transcribeResponse.json();

    if (!transcribeData.success) {
      throw new Error(transcribeData.error);
    }

    transcriptionData = transcribeData.transcription;
    transcriptSegments = transcriptionData.segments || [];
    audioFilePath = transcribeData.audioFilePath; // Store for speaker extraction

    // Analyze transcript
    document.getElementById('progress-text').textContent = 'Analyzing transcript and detecting speakers...';
    document.getElementById('progress-bar').style.width = '60%';

    const analyzeResponse = await fetch(`${API_BASE}/api/analyze-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: transcriptSegments })
    });

    const analyzeData = await analyzeResponse.json();

    if (!analyzeData.success) {
      throw new Error(analyzeData.error);
    }

    analysisData = analyzeData.analysis;
    detectedSpeakers = analyzeData.detectedSpeakers || [];

    // Display transcript review
    document.getElementById('progress-text').textContent = 'Complete!';
    document.getElementById('progress-bar').style.width = '100%';

    setTimeout(() => {
      displayTranscriptReview();
    }, 500);

  } catch (error) {
    console.error('Processing error:', error);
    document.getElementById('progress-text').textContent = `Error: ${error.message}`;
    alert(`Failed to process recording: ${error.message}`);
  }
}

// Step 4: Transcript Review & Filtering
function displayTranscriptReview() {
  const segmentsList = document.getElementById('segments-list');
  segmentsList.innerHTML = '';

  transcriptSegments.forEach((segment, index) => {
    const analysis = analysisData.find(a => a.segmentIndex === index) || {
      isWorkRelated: true,
      topic: 'Unknown'
    };

    const segmentDiv = document.createElement('div');
    segmentDiv.className = 'segment-item';
    segmentDiv.innerHTML = `
      <div class="segment-header">
        <input type="checkbox" id="segment-${index}" class="segment-checkbox" ${analysis.isWorkRelated ? 'checked' : ''}>
        <label for="segment-${index}">
          <span class="segment-time">[${formatTime(segment.start)} - ${formatTime(segment.end)}]</span>
          <span class="segment-topic ${analysis.isWorkRelated ? 'work-related' : 'casual'}">${analysis.topic}</span>
        </label>
      </div>
      <p class="segment-text">${segment.text}</p>
    `;
    segmentsList.appendChild(segmentDiv);
  });

  document.getElementById('transcript-review').style.display = 'block';
  document.querySelector('.progress-container').style.display = 'none';
  document.getElementById('progress-text').style.display = 'none';
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

document.getElementById('include-all').addEventListener('click', () => {
  document.querySelectorAll('.segment-checkbox').forEach(checkbox => {
    checkbox.checked = true;
  });
});

document.getElementById('exclude-all').addEventListener('click', () => {
  document.querySelectorAll('.segment-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
});

document.getElementById('start-processing').addEventListener('click', async () => {
  // Get selected segments
  const selectedSegments = [];
  document.querySelectorAll('.segment-checkbox').forEach((checkbox, index) => {
    if (checkbox.checked && transcriptSegments[index]) {
      selectedSegments.push(transcriptSegments[index]);
    }
  });

  if (selectedSegments.length === 0) {
    alert('Please select at least one segment to include in the minutes');
    return;
  }

  // Generate summary
  const filteredTranscript = selectedSegments.map(seg => seg.text).join(' ');

  try {
    const response = await fetch(`${API_BASE}/api/generate-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filteredTranscript })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    summaryData = data.summary;

    // Move to speaker identification
    showStep(5);
    displaySpeakerIdentification();

  } catch (error) {
    console.error('Summary generation error:', error);
    alert(`Failed to generate summary: ${error.message}`);
  }
});

// Step 5: Speaker Identification
async function displaySpeakerIdentification() {
  const speakerSegments = document.getElementById('speaker-segments');
  speakerSegments.innerHTML = '<p class="info-text">Loading speaker samples...</p>';

  try {
    // Get selected segments
    const selectedSegments = [];
    document.querySelectorAll('.segment-checkbox').forEach((checkbox, index) => {
      if (checkbox.checked && transcriptSegments[index]) {
        selectedSegments.push({ ...transcriptSegments[index], originalIndex: index });
      }
    });

    // Extract speaker samples from audio
    const sampleResponse = await fetch(`${API_BASE}/api/extract-speaker-snippets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioPath: audioFilePath,
        segments: selectedSegments
      })
    });

    const sampleData = await sampleResponse.json();

    if (!sampleData.success) {
      throw new Error(sampleData.error);
    }

    speakerSamples = sampleData.speakerSamples;

    // Display detected speakers from introductions
    let detectedSpeakersHtml = '';
    if (detectedSpeakers.length > 0) {
      detectedSpeakersHtml = `
        <div class="detected-speakers-notice">
          <h4>✓ Detected Speaker Introductions:</h4>
          <ul>
            ${detectedSpeakers.map(s => `<li><strong>${s.name}</strong> (from segment ${s.segmentIndex})</li>`).join('')}
          </ul>
          <p class="info-text">These names will be automatically applied to matching voice patterns.</p>
        </div>
      `;
    }

    // Display speaker samples with audio players
    speakerSegments.innerHTML = detectedSpeakersHtml + `
      <p class="info-text" style="margin-bottom: 20px;">
        Listen to each audio sample below and assign the speaker's name. Once identified,
        their name will be automatically applied to all segments where they speak.
      </p>
    `;

    for (const sample of speakerSamples) {
      const sampleDiv = document.createElement('div');
      sampleDiv.className = 'speaker-sample-card';
      sampleDiv.innerHTML = `
        <div class="speaker-sample-header">
          <span class="sample-number">Speaker Sample ${sample.sampleIndex + 1}</span>
          <span class="sample-time">${formatTime(sample.startTime)} - ${formatTime(sample.endTime)}</span>
        </div>
        <div class="audio-player-container">
          <audio id="audio-sample-${sample.sampleIndex}" controls preload="none" class="speaker-audio-player">
            <source src="" type="audio/mpeg">
            Your browser does not support the audio element.
          </audio>
          <button class="btn btn-secondary btn-small load-audio-btn" data-sample-index="${sample.sampleIndex}">
            Load Audio Sample
          </button>
        </div>
        <p class="sample-preview-text">"${sample.text}"</p>
        <div class="speaker-input-group">
          <label for="speaker-name-${sample.sampleIndex}">Speaker Name:</label>
          <input type="text"
                 id="speaker-name-${sample.sampleIndex}"
                 class="speaker-name-input"
                 placeholder="Enter speaker name..."
                 list="participants-datalist"
                 data-sample-index="${sample.sampleIndex}"
                 data-segment-index="${sample.segmentIndex}">
        </div>
      `;
      speakerSegments.appendChild(sampleDiv);

      // Add load button event listener
      const loadBtn = sampleDiv.querySelector('.load-audio-btn');
      loadBtn.addEventListener('click', async () => {
        await loadSpeakerAudio(sample.sampleIndex, sample.startTime, sample.endTime);
      });
    }

    // Pre-fill detected speaker names if available
    detectedSpeakers.forEach(detected => {
      // Find the sample that corresponds to this segment
      const matchingSample = speakerSamples.find(s => s.segmentIndex === detected.segmentIndex);
      if (matchingSample) {
        const input = document.getElementById(`speaker-name-${matchingSample.sampleIndex}`);
        if (input) {
          input.value = detected.name;
        }
      }
    });

    // Create datalist for autocomplete
    updateParticipantsDatalist();

  } catch (error) {
    console.error('Speaker identification display error:', error);
    speakerSegments.innerHTML = `<p class="error-text">Error loading speaker samples: ${error.message}</p>`;
  }
}

// Load audio sample for speaker identification
async function loadSpeakerAudio(sampleIndex, startTime, endTime) {
  const loadBtn = document.querySelector(`[data-sample-index="${sampleIndex}"]`);
  const audioElement = document.getElementById(`audio-sample-${sampleIndex}`);

  try {
    loadBtn.textContent = 'Loading...';
    loadBtn.disabled = true;

    const response = await fetch(`${API_BASE}/api/get-speaker-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioFile: audioFilePath,
        startTime,
        endTime
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    // Set audio source
    audioElement.src = data.audioData;
    audioElement.load();

    // Hide load button, show player
    loadBtn.style.display = 'none';
    audioElement.style.display = 'block';

    // Auto-play
    audioElement.play().catch(e => console.log('Autoplay prevented:', e));

  } catch (error) {
    console.error('Load speaker audio error:', error);
    loadBtn.textContent = 'Error - Try Again';
    loadBtn.disabled = false;
    alert(`Failed to load audio: ${error.message}`);
  }
}

document.getElementById('participants-list').addEventListener('input', () => {
  updateParticipantsDatalist();
});

function updateParticipantsDatalist() {
  const participantsText = document.getElementById('participants-list').value;
  participants = participantsText.split('\n').map(p => p.trim()).filter(p => p.length > 0);

  // Update or create datalist
  let datalist = document.getElementById('participants-datalist');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'participants-datalist';
    document.body.appendChild(datalist);
  }

  datalist.innerHTML = '';
  participants.forEach(participant => {
    const option = document.createElement('option');
    option.value = participant;
    datalist.appendChild(option);
  });
}

document.getElementById('skip-speakers').addEventListener('click', () => {
  // Use "Unknown Speaker" for all
  speakerAssignments = {};
  document.querySelectorAll('.segment-checkbox').forEach((checkbox, index) => {
    if (checkbox.checked) {
      speakerAssignments[index] = 'Unknown Speaker';
    }
  });

  showStep(6);
  displayFinalReview();
});

document.getElementById('apply-speakers').addEventListener('click', () => {
  // Collect speaker sample assignments
  const speakerSampleMap = {};
  document.querySelectorAll('.speaker-name-input').forEach(input => {
    const sampleIndex = parseInt(input.dataset.sampleIndex);
    const segmentIndex = parseInt(input.dataset.segmentIndex);
    const speakerName = input.value.trim() || 'Unknown Speaker';

    speakerSampleMap[sampleIndex] = {
      name: speakerName,
      segmentIndex: segmentIndex
    };
  });

  // Apply automatic speaker mapping across all selected segments
  speakerAssignments = {};

  document.querySelectorAll('.segment-checkbox').forEach((checkbox, index) => {
    if (checkbox.checked) {
      let assignedSpeaker = 'Unknown Speaker';

      // Find the closest speaker sample before this segment
      let closestSample = null;
      let closestDistance = Infinity;

      speakerSamples.forEach((sample, sampleIdx) => {
        const speakerInfo = speakerSampleMap[sampleIdx];
        if (speakerInfo && transcriptSegments[index]) {
          const timeDiff = Math.abs(transcriptSegments[index].start - sample.startTime);

          // Prefer samples from the same general time period (within 60 seconds)
          if (timeDiff < closestDistance && timeDiff < 60) {
            closestDistance = timeDiff;
            closestSample = speakerInfo;
          }
        }
      });

      if (closestSample) {
        assignedSpeaker = closestSample.name;
      }

      speakerAssignments[index] = assignedSpeaker;
    }
  });

  console.log('Speaker assignments:', speakerAssignments);

  showStep(6);
  displayFinalReview();
});

// Step 6: Final Review & Export
function displayFinalReview() {
  // Set document title and date
  const meetingTitle = document.getElementById('meeting-title-input').value || 'Meeting';
  document.getElementById('document-title').value = meetingTitle;
  document.getElementById('meeting-date').value = new Date().toISOString().split('T')[0];

  // Display summary
  document.getElementById('summary-text').textContent = summaryData.summary;

  // Display key points
  const keyPointsList = document.getElementById('key-points-list');
  keyPointsList.innerHTML = '';
  summaryData.keyPoints.forEach(point => {
    const li = document.createElement('li');
    li.textContent = point;
    keyPointsList.appendChild(li);
  });

  // Display action items
  const actionItemsList = document.getElementById('action-items-list');
  actionItemsList.innerHTML = '';
  summaryData.actionItems.forEach((action, index) => {
    const actionDiv = document.createElement('div');
    actionDiv.className = 'action-item';
    actionDiv.innerHTML = `
      <strong>${index + 1}. ${action.task}</strong><br>
      <em>Assignee: ${action.assignee}</em><br>
      ${action.deadline !== 'Not specified' ? `<em>Due: ${action.deadline}</em>` : ''}
    `;
    actionItemsList.appendChild(actionDiv);
  });

  // Display topics
  const topicsList = document.getElementById('topics-list');
  topicsList.innerHTML = '';
  summaryData.topics.forEach(topic => {
    const topicDiv = document.createElement('div');
    topicDiv.className = 'topic-item';
    topicDiv.innerHTML = `
      <h4>${topic.title}</h4>
      <p>${topic.content}</p>
    `;
    topicsList.appendChild(topicDiv);
  });

  // Display participants
  const participantsPreview = document.getElementById('participants-preview');
  if (participants.length > 0) {
    participantsPreview.innerHTML = `
      <div class="participants-grid">
        ${participants.map(p => `<div class="participant-name">${p}</div>`).join('')}
      </div>
    `;
  } else {
    participantsPreview.innerHTML = '<p class="info-text">No participants listed</p>';
  }
}

document.getElementById('export-document').addEventListener('click', async () => {
  try {
    const title = document.getElementById('document-title').value || 'Meeting';
    const dateInput = document.getElementById('meeting-date').value;
    const dateObject = new Date(dateInput).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Format date as yyyy/mm/dd
    const dateParts = dateInput.split('-');
    const date = `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}`;

    // Build transcript lines with speakers
    const transcriptLines = [];
    document.querySelectorAll('.segment-checkbox').forEach((checkbox, index) => {
      if (checkbox.checked && transcriptSegments[index]) {
        transcriptLines.push({
          speaker: speakerAssignments[index] || 'Unknown Speaker',
          text: transcriptSegments[index].text
        });
      }
    });

    // Generate documents
    const response = await fetch(`${API_BASE}/api/generate-documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        date,
        dateObject,
        participants,
        summary: summaryData.summary,
        keyPoints: summaryData.keyPoints,
        topics: summaryData.topics,
        actionItems: summaryData.actionItems,
        transcriptLines
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    // Display download links
    const downloadLinks = document.getElementById('download-links');
    downloadLinks.style.display = 'block';

    if (data.summaryUrl && data.transcriptUrl) {
      // Firebase storage URLs
      downloadLinks.innerHTML = `
        <h3>Documents Ready!</h3>
        <p>Your documents have been saved to cloud storage:</p>
        <a href="${data.summaryUrl}" class="btn btn-primary" download>Download ${data.summaryFileName}</a>
        <a href="${data.transcriptUrl}" class="btn btn-primary" download>Download ${data.transcriptFileName}</a>
      `;
    } else {
      // Local file download
      const summaryFileName = `${date.replace(/\//g, '-')} – ${title} – Summary.docx`;
      const transcriptFileName = `${date.replace(/\//g, '-')} – ${title} – Transcript.docx`;

      downloadLinks.innerHTML = `
        <h3>Documents Ready!</h3>
        <p>Your documents have been generated:</p>
        <a href="${API_BASE}/api/download/summary/${summaryFileName}" class="btn btn-primary" download>Download Summary</a>
        <a href="${API_BASE}/api/download/transcript/${transcriptFileName}" class="btn btn-primary" download>Download Transcript</a>
      `;
    }

    alert('Documents generated successfully!');

  } catch (error) {
    console.error('Export error:', error);
    alert(`Failed to export documents: ${error.message}`);
  }
});

document.getElementById('start-new').addEventListener('click', () => {
  if (confirm('Start a new meeting? This will reset all current data.')) {
    location.reload();
  }
});

// Navigation buttons
document.getElementById('prev-step').addEventListener('click', () => {
  if (currentStep > 1) {
    showStep(currentStep - 1);
  }
});

document.getElementById('next-step').addEventListener('click', () => {
  if (currentStep < 6) {
    showStep(currentStep + 1);
  }
});

// Password toggle functionality
document.getElementById('toggle-password')?.addEventListener('click', function() {
  const passwordInput = document.getElementById('login-password');
  const eyeIcon = document.getElementById('eye-icon');

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    // Change to eye-slash icon
    eyeIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    `;
  } else {
    passwordInput.type = 'password';
    // Change back to eye icon
    eyeIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    `;
  }
});

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  console.log('Meeting Minutes Web App loaded');
  showStep(0); // Start with login screen
  checkAuthStatus(); // Check if user is already logged in
});
