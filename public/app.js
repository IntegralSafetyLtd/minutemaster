// Meeting Minutes Web App - Frontend JavaScript
// This handles all UI interactions and communication with the backend API

// Global state
let currentStep = 1;
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
  const steps = ['api', 'microphone', 'recording', 'processing', 'speakers', 'export'];
  return steps[stepNumber - 1];
}

function updateNavigationButtons() {
  const prevBtn = document.getElementById('prev-step');
  const nextBtn = document.getElementById('next-step');

  prevBtn.disabled = currentStep === 1;
  // Next button is controlled by individual step logic
}

// Step 1: API Key Setup
async function checkApiKeyStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/check-config`);
    const data = await response.json();

    if (data.success && data.hasApiKey && data.isInitialized) {
      // API key is already configured, show status and skip to step 2
      document.getElementById('api-key-status').style.display = 'block';
      document.getElementById('api-key-form').style.display = 'none';

      // Auto-advance to microphone selection
      setTimeout(() => {
        showStep(2);
        loadMicrophones();
      }, 500);
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
  document.getElementById('api-key').value = '';
  document.getElementById('api-key').focus();
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
    mediaRecorder = new MediaRecorder(mixedStream, { mimeType: 'audio/webm' });
    audioChunks = [];

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
    // Create audio blob
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

    // Create form data
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

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

    // Analyze transcript
    document.getElementById('progress-text').textContent = 'Analyzing transcript...';
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
function displaySpeakerIdentification() {
  const speakerSegments = document.getElementById('speaker-segments');
  speakerSegments.innerHTML = '';

  // Get selected segments
  const selectedSegments = [];
  document.querySelectorAll('.segment-checkbox').forEach((checkbox, index) => {
    if (checkbox.checked && transcriptSegments[index]) {
      selectedSegments.push({ ...transcriptSegments[index], originalIndex: index });
    }
  });

  selectedSegments.forEach((segment, index) => {
    const segmentDiv = document.createElement('div');
    segmentDiv.className = 'speaker-segment';
    segmentDiv.innerHTML = `
      <div class="speaker-segment-header">
        <span class="segment-number">Segment ${index + 1}</span>
        <span class="segment-time">${formatTime(segment.start)} - ${formatTime(segment.end)}</span>
      </div>
      <p class="segment-text">${segment.text}</p>
      <div class="speaker-input-group">
        <label for="speaker-${index}">Speaker:</label>
        <input type="text" id="speaker-${index}" class="speaker-name-input"
               placeholder="Enter speaker name..."
               list="participants-datalist"
               data-segment-index="${segment.originalIndex}">
      </div>
    `;
    speakerSegments.appendChild(segmentDiv);
  });

  // Create datalist for autocomplete
  updateParticipantsDatalist();
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
  // Collect speaker assignments
  speakerAssignments = {};
  document.querySelectorAll('.speaker-name-input').forEach(input => {
    const segmentIndex = parseInt(input.dataset.segmentIndex);
    const speakerName = input.value.trim() || 'Unknown Speaker';
    speakerAssignments[segmentIndex] = speakerName;
  });

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

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  console.log('Meeting Minutes Web App loaded');
  showStep(1);
  checkApiKeyStatus(); // Check if API key is already saved
});
