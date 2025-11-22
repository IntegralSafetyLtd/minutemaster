const { ipcRenderer } = require('electron');

// Application state
let currentStep = 1;
let apiKeyConfigured = false;
let selectedMicrophones = [];
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let audioFilePath = null;
let transcriptSegments = [];
let analysisResults = [];
let speakerLabels = {};
let finalSummary = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  detectMicrophones();
});

function initializeEventListeners() {
  // API Key
  document.getElementById('save-api-key').addEventListener('click', saveApiKey);

  // Microphone selection
  document.getElementById('next-to-recording').addEventListener('click', () => {
    if (validateMicrophoneSelection()) {
      goToStep(3);
    }
  });

  // Recording controls
  document.getElementById('start-recording').addEventListener('click', startRecording);
  document.getElementById('stop-recording').addEventListener('click', stopRecording);

  // Processing
  document.getElementById('include-all').addEventListener('click', includeAllSegments);
  document.getElementById('exclude-all').addEventListener('click', excludeAllSegments);
  document.getElementById('start-processing').addEventListener('click', generateSummary);

  // Speaker identification
  document.getElementById('skip-speakers').addEventListener('click', () => {
    goToStep(6);
    displayFinalReview();
  });
  document.getElementById('apply-speakers').addEventListener('click', applySpeakers);

  // Export format selection
  document.getElementById('export-pdf').addEventListener('change', (e) => {
    const passwordSection = document.getElementById('pdf-password-section');
    passwordSection.style.display = e.target.checked ? 'block' : 'none';
  });

  // Export
  document.getElementById('export-document').addEventListener('click', exportDocument);
  document.getElementById('start-new').addEventListener('click', startNew);

  // Navigation
  document.getElementById('prev-step').addEventListener('click', () => goToStep(currentStep - 1));
  document.getElementById('next-step').addEventListener('click', () => goToStep(currentStep + 1));

  // Step dots
  document.querySelectorAll('.step-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const step = parseInt(dot.dataset.step);
      if (canNavigateToStep(step)) {
        goToStep(step);
      }
    });
  });
}

async function saveApiKey() {
  const apiKey = document.getElementById('api-key').value.trim();

  if (!apiKey) {
    alert('Please enter an API key');
    return;
  }

  const btn = document.getElementById('save-api-key');
  btn.disabled = true;
  btn.textContent = 'Validating...';

  const result = await ipcRenderer.invoke('init-openai', apiKey);

  if (result.success) {
    apiKeyConfigured = true;
    alert('API key saved successfully!');
    goToStep(2);
  } else {
    alert(`Error: ${result.error}`);
  }

  btn.disabled = false;
  btn.textContent = 'Save API Key';
}

async function detectMicrophones() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');

    const micList = document.getElementById('microphone-list');
    micList.innerHTML = '';

    if (audioInputs.length === 0) {
      micList.innerHTML = '<p class="info-text">No microphones detected. Please connect a microphone and restart the app.</p>';
      return;
    }

    audioInputs.forEach((device, index) => {
      const item = document.createElement('div');
      item.className = 'microphone-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `mic-${index}`;
      checkbox.value = device.deviceId;

      const label = document.createElement('label');
      label.htmlFor = `mic-${index}`;
      label.textContent = device.label || `Microphone ${index + 1}`;

      item.appendChild(checkbox);
      item.appendChild(label);
      micList.appendChild(item);
    });
  } catch (error) {
    console.error('Error detecting microphones:', error);
    alert('Error detecting microphones. Please check permissions.');
  }
}

function validateMicrophoneSelection() {
  const checkboxes = document.querySelectorAll('#microphone-list input[type="checkbox"]:checked');
  selectedMicrophones = Array.from(checkboxes).map(cb => cb.value);

  if (selectedMicrophones.length === 0) {
    alert('Please select at least one microphone');
    return false;
  }

  return true;
}

async function startRecording() {
  try {
    // Get audio stream from selected microphones
    // Note: Web Audio API doesn't support multiple simultaneous microphones directly
    // We'll use the first selected microphone for simplicity
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedMicrophones[0],
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    // Set up audio visualizer
    setupAudioVisualizer(stream);

    // Initialize MediaRecorder
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm'
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      await saveRecording();
    };

    mediaRecorder.start();

    // Update UI
    document.getElementById('start-recording').disabled = true;
    document.getElementById('stop-recording').disabled = false;
    document.getElementById('recording-indicator').classList.add('active');

    // Start timer
    recordingStartTime = Date.now();
    recordingTimer = setInterval(updateRecordingTime, 1000);

  } catch (error) {
    console.error('Error starting recording:', error);
    alert('Error starting recording. Please check microphone permissions.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();

    // Stop all tracks
    mediaRecorder.stream.getTracks().forEach(track => track.stop());

    // Update UI
    document.getElementById('start-recording').disabled = false;
    document.getElementById('stop-recording').disabled = true;
    document.getElementById('recording-indicator').classList.remove('active');

    // Stop timer
    clearInterval(recordingTimer);
  }
}

function updateRecordingTime() {
  const elapsed = Date.now() - recordingStartTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  document.getElementById('recording-time').textContent =
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setupAudioVisualizer(stream) {
  const canvas = document.getElementById('audio-visualizer');
  const ctx = canvas.getContext('2d');
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(stream);

  source.connect(analyser);
  analyser.fftSize = 256;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;

      const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
      gradient.addColorStop(0, '#667eea');
      gradient.addColorStop(1, '#764ba2');

      ctx.fillStyle = gradient;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

      x += barWidth + 1;
    }
  }

  draw();
}

async function saveRecording() {
  try {
    // Convert audio chunks to buffer
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Save audio file
    const filename = `meeting-${Date.now()}.webm`;
    const result = await ipcRenderer.invoke('save-audio', arrayBuffer, filename);

    if (result.success) {
      audioFilePath = result.path;
      console.log('Audio saved to:', audioFilePath);

      // Move to processing step
      goToStep(4);
      await processRecording();
    } else {
      alert(`Error saving recording: ${result.error}`);
    }
  } catch (error) {
    console.error('Error saving recording:', error);
    alert('Error saving recording. Please try again.');
  }
}

async function processRecording() {
  try {
    // Show processing UI
    document.getElementById('transcript-review').style.display = 'none';
    updateProgress(10, 'Transcribing audio...');

    // Transcribe audio
    const transcriptResult = await ipcRenderer.invoke('transcribe-audio', audioFilePath);

    if (!transcriptResult.success) {
      throw new Error(transcriptResult.error);
    }

    transcriptSegments = transcriptResult.transcription.segments || [];
    updateProgress(50, 'Analyzing content...');

    // Analyze transcript
    const analysisResult = await ipcRenderer.invoke('analyze-transcript', transcriptSegments);

    if (!analysisResult.success) {
      throw new Error(analysisResult.error);
    }

    analysisResults = analysisResult.analysis;
    updateProgress(100, 'Analysis complete!');

    // Display segments for review
    setTimeout(() => {
      displayTranscriptSegments();
      document.getElementById('transcript-review').style.display = 'block';
    }, 500);

  } catch (error) {
    console.error('Error processing recording:', error);
    alert(`Error processing recording: ${error.message}`);
  }
}

function updateProgress(percentage, text) {
  document.getElementById('progress-bar').style.width = `${percentage}%`;
  document.getElementById('progress-text').textContent = text;
}

function displayTranscriptSegments() {
  const segmentsList = document.getElementById('segments-list');
  segmentsList.innerHTML = '';

  transcriptSegments.forEach((segment, index) => {
    const analysis = analysisResults.find(a => a.segmentIndex === index);
    const isWorkRelated = analysis ? analysis.isWorkRelated : true;
    const topic = analysis ? analysis.topic : '';

    const item = document.createElement('div');
    item.className = `segment-item ${isWorkRelated ? 'work-related' : 'casual'}`;
    item.dataset.index = index;

    const header = document.createElement('div');
    header.className = 'segment-header';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isWorkRelated;
    checkbox.dataset.index = index;
    checkbox.addEventListener('change', toggleSegment);

    const timestamp = document.createElement('span');
    timestamp.className = 'segment-timestamp';
    timestamp.textContent = `${formatTime(segment.start)} - ${formatTime(segment.end)}`;

    const tag = document.createElement('span');
    tag.className = `segment-tag ${isWorkRelated ? 'work' : 'casual'}`;
    tag.textContent = isWorkRelated ? 'Work' : 'Casual';

    header.appendChild(checkbox);
    header.appendChild(timestamp);
    header.appendChild(tag);

    const text = document.createElement('div');
    text.className = 'segment-text';
    text.textContent = segment.text;

    const topicDiv = document.createElement('div');
    topicDiv.className = 'segment-topic';
    topicDiv.textContent = topic;

    item.appendChild(header);
    item.appendChild(text);
    if (topic) item.appendChild(topicDiv);

    segmentsList.appendChild(item);
  });
}

function toggleSegment(event) {
  const item = event.target.closest('.segment-item');
  if (event.target.checked) {
    item.classList.remove('excluded');
  } else {
    item.classList.add('excluded');
  }
}

function includeAllSegments() {
  document.querySelectorAll('.segment-item input[type="checkbox"]').forEach(cb => {
    cb.checked = true;
    cb.closest('.segment-item').classList.remove('excluded');
  });
}

function excludeAllSegments() {
  document.querySelectorAll('.segment-item input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    cb.closest('.segment-item').classList.add('excluded');
  });
}

async function generateSummary() {
  try {
    // Get included segments
    const includedSegments = transcriptSegments.filter((segment, index) => {
      const checkbox = document.querySelector(`.segment-item[data-index="${index}"] input[type="checkbox"]`);
      return checkbox && checkbox.checked;
    });

    if (includedSegments.length === 0) {
      alert('Please include at least one segment');
      return;
    }

    // Create filtered transcript
    const filteredTranscript = includedSegments.map(seg => seg.text).join('\n\n');

    // Show progress
    goToStep(5);
    updateProgress(0, 'Generating summary...');

    // Generate summary
    const summaryResult = await ipcRenderer.invoke('generate-summary', filteredTranscript);

    if (!summaryResult.success) {
      throw new Error(summaryResult.error);
    }

    finalSummary = summaryResult.summary;
    updateProgress(100, 'Summary generated!');

    // Move to speaker identification
    setTimeout(() => {
      displaySpeakerIdentification();
    }, 500);

  } catch (error) {
    console.error('Error generating summary:', error);
    alert(`Error generating summary: ${error.message}`);
  }
}

function displaySpeakerIdentification() {
  const segmentsContainer = document.getElementById('speaker-segments');
  segmentsContainer.innerHTML = '';

  // Get included segments only
  const includedSegments = transcriptSegments.filter((segment, index) => {
    const checkbox = document.querySelector(`.segment-item[data-index="${index}"] input[type="checkbox"]`);
    return checkbox && checkbox.checked;
  });

  includedSegments.forEach((segment, index) => {
    const item = document.createElement('div');
    item.className = 'speaker-segment-item';

    const header = document.createElement('div');
    header.className = 'speaker-segment-header';

    const timestamp = document.createElement('span');
    timestamp.textContent = formatTime(segment.start);
    timestamp.style.fontWeight = '600';
    timestamp.style.color = '#666';
    timestamp.style.marginRight = '12px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Speaker name...';
    input.dataset.segmentIndex = transcriptSegments.indexOf(segment);
    input.id = `speaker-input-${index}`;
    input.list = 'participants-datalist';

    header.appendChild(timestamp);
    header.appendChild(input);

    const text = document.createElement('div');
    text.className = 'speaker-segment-text';
    text.textContent = segment.text;

    item.appendChild(header);
    item.appendChild(text);
    segmentsContainer.appendChild(item);
  });

  // Create datalist for autocomplete from participants
  let datalist = document.getElementById('participants-datalist');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'participants-datalist';
    document.body.appendChild(datalist);
  }
}

async function applySpeakers() {
  // Collect speaker assignments from inputs
  const inputs = document.querySelectorAll('#speaker-segments input[type="text"]');

  inputs.forEach(input => {
    const segmentIndex = parseInt(input.dataset.segmentIndex);
    const speakerName = input.value.trim();

    if (speakerName && transcriptSegments[segmentIndex]) {
      transcriptSegments[segmentIndex].speaker = speakerName;
    }
  });

  // Move to export
  goToStep(6);
  displayFinalReview();
}

function displayFinalReview() {
  // Set default document title and date
  const titleInput = document.getElementById('document-title');
  const dateInput = document.getElementById('meeting-date');

  titleInput.value = document.getElementById('meeting-title').value || 'Meeting Minutes';
  dateInput.valueAsDate = new Date();

  // Get participants from textarea
  const participantsText = document.getElementById('participants-list').value.trim();
  const participants = participantsText.split('\n').map(p => p.trim()).filter(p => p.length > 0);

  // Display participants in preview
  const participantsPreview = document.getElementById('participants-preview');
  participantsPreview.innerHTML = '';

  if (participants.length > 0) {
    participants.forEach(name => {
      const nameDiv = document.createElement('div');
      nameDiv.className = 'participant-name';
      nameDiv.textContent = name;
      participantsPreview.appendChild(nameDiv);
    });
  } else {
    participantsPreview.innerHTML = '<p class="info-text">No participants listed</p>';
  }

  // Display summary
  document.getElementById('summary-text').textContent = finalSummary.summary;

  // Display key points
  const keyPointsList = document.getElementById('key-points-list');
  keyPointsList.innerHTML = '';
  finalSummary.keyPoints.forEach(point => {
    const li = document.createElement('li');
    li.textContent = point;
    keyPointsList.appendChild(li);
  });

  // Display action items
  const actionItemsList = document.getElementById('action-items-list');
  actionItemsList.innerHTML = '';
  finalSummary.actionItems.forEach(action => {
    const item = document.createElement('div');
    item.className = 'action-item';

    const task = document.createElement('div');
    task.className = 'action-task';
    task.textContent = action.task;

    const meta = document.createElement('div');
    meta.className = 'action-meta';
    meta.textContent = `Assignee: ${action.assignee} | Deadline: ${action.deadline}`;

    item.appendChild(task);
    item.appendChild(meta);
    actionItemsList.appendChild(item);
  });

  // Display topics
  const topicsList = document.getElementById('topics-list');
  topicsList.innerHTML = '';
  finalSummary.topics.forEach(topic => {
    const item = document.createElement('div');
    item.className = 'topic-item';

    const title = document.createElement('div');
    title.className = 'topic-title';
    title.textContent = topic.title;

    const content = document.createElement('div');
    content.className = 'topic-content';
    content.textContent = topic.content;

    item.appendChild(title);
    item.appendChild(content);
    topicsList.appendChild(item);
  });
}

async function exportDocument() {
  try {
    const btn = document.getElementById('export-document');
    btn.disabled = true;
    btn.textContent = 'Generating...';

    // Get export settings
    const exportWord = document.getElementById('export-word').checked;
    const exportPdf = document.getElementById('export-pdf').checked;
    const pdfPassword = document.getElementById('pdf-password').value;

    if (!exportWord && !exportPdf) {
      alert('Please select at least one export format (Word or PDF)');
      btn.disabled = false;
      btn.textContent = 'Export Documents';
      return;
    }

    // Get document settings
    const title = document.getElementById('document-title').value.trim() || 'Meeting Minutes';
    const dateInput = document.getElementById('meeting-date').value;
    const meetingDate = dateInput ? new Date(dateInput) : new Date();

    // Format date as yyyy/mm/dd
    const formattedDate = `${meetingDate.getFullYear()}/${String(meetingDate.getMonth() + 1).padStart(2, '0')}/${String(meetingDate.getDate()).padStart(2, '0')}`;

    // Get participants
    const participantsText = document.getElementById('participants-list').value.trim();
    const participants = participantsText.split('\n').map(p => p.trim()).filter(p => p.length > 0);

    // Prepare transcript with speakers (line by line)
    const includedSegments = transcriptSegments.filter((segment, index) => {
      const checkbox = document.querySelector(`.segment-item[data-index="${index}"] input[type="checkbox"]`);
      return checkbox && checkbox.checked;
    });

    const transcriptLines = includedSegments.map(seg => ({
      speaker: seg.speaker || 'Unknown Speaker',
      text: seg.text,
      timestamp: formatTime(seg.start)
    }));

    const meetingData = {
      title: title,
      date: formattedDate,
      dateObject: meetingDate.toLocaleDateString(),
      participants: participants,
      summary: finalSummary.summary,
      keyPoints: finalSummary.keyPoints,
      topics: finalSummary.topics,
      actionItems: finalSummary.actionItems,
      transcriptLines: transcriptLines,
      exportFormats: {
        word: exportWord,
        pdf: exportPdf,
        pdfPassword: pdfPassword
      }
    };

    const result = await ipcRenderer.invoke('generate-documents', meetingData);

    if (result.success) {
      let message = 'Documents generated successfully:\n\n';
      if (result.summaryPath) message += `Summary: ${result.summaryPath}\n`;
      if (result.transcriptPath) message += `Transcript: ${result.transcriptPath}\n`;
      if (result.pdfPaths) {
        if (result.pdfPaths.summary) message += `\nSummary PDF: ${result.pdfPaths.summary}`;
        if (result.pdfPaths.transcript) message += `\nTranscript PDF: ${result.pdfPaths.transcript}`;
      }
      alert(message);
    } else {
      if (result.error !== 'Save cancelled') {
        alert(`Error: ${result.error}`);
      }
    }

    btn.disabled = false;
    btn.textContent = 'Export Documents';

  } catch (error) {
    console.error('Error exporting document:', error);
    alert(`Error exporting document: ${error.message}`);
    document.getElementById('export-document').disabled = false;
    document.getElementById('export-document').textContent = 'Export Documents';
  }
}

function startNew() {
  if (confirm('Start a new meeting? All current data will be lost.')) {
    location.reload();
  }
}

function goToStep(step) {
  if (step < 1 || step > 6) return;

  // Hide current step
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));

  // Show new step
  document.getElementById(`step-${getStepId(step)}`).classList.add('active');

  // Update step indicators
  document.querySelectorAll('.step-dot').forEach(dot => {
    dot.classList.remove('active');
  });
  document.querySelector(`.step-dot[data-step="${step}"]`).classList.add('active');

  currentStep = step;

  // Update navigation buttons
  updateNavigationButtons();
}

function getStepId(step) {
  const stepIds = ['api', 'microphone', 'recording', 'processing', 'speakers', 'export'];
  return stepIds[step - 1];
}

function canNavigateToStep(step) {
  // Can only go back or to steps already completed
  if (step < currentStep) return true;
  if (step === 2 && apiKeyConfigured) return true;
  return false;
}

function updateNavigationButtons() {
  const prevBtn = document.getElementById('prev-step');
  const nextBtn = document.getElementById('next-step');

  prevBtn.disabled = currentStep === 1;
  nextBtn.disabled = currentStep === 6;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
