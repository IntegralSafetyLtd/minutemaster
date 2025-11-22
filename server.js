const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const OpenAI = require('openai');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const admin = require('firebase-admin');
const { encrypt, decrypt, validateCrypto } = require('./crypto-utils');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Validate crypto on startup
try {
  validateCrypto();
  console.log('✓ Encryption system validated');
} catch (error) {
  console.error('⚠️  Encryption validation failed:', error.message);
}

// Load or create config file
let config = { encryptedApiKey: null };

async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    config = JSON.parse(data);
    console.log('✓ Configuration loaded');
  } catch (error) {
    // Config file doesn't exist, will be created when user saves API key
    console.log('No config file found, will create on first setup');
  }
}

async function saveConfig() {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('✓ Configuration saved');
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

// Firebase initialization (user needs to add their serviceAccountKey.json)
let db, storage;
try {
  const serviceAccount = require('./firebase-config/serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'minutemaster-ef8d3.firebasestorage.app'
  });
  db = admin.firestore();
  storage = admin.storage().bucket();
  console.log('✓ Firebase initialized successfully');
} catch (error) {
  console.warn('⚠️  Firebase not configured. Add serviceAccountKey.json to firebase-config/ folder');
}

// OpenAI client
let openaiClient;

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({
  dest: 'temp-uploads/',
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Ensure temp directories exist and initialize
async function ensureDirectories() {
  try {
    await fs.mkdir('temp-uploads', { recursive: true });
    await fs.mkdir('temp-output', { recursive: true });
    await fs.mkdir('firebase-config', { recursive: true });
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

async function initializeApp() {
  await loadConfig();
  await ensureDirectories();

  // Initialize OpenAI client if encrypted API key exists in config
  if (config.encryptedApiKey) {
    try {
      const apiKey = decrypt(config.encryptedApiKey);
      if (apiKey) {
        openaiClient = new OpenAI({ apiKey });
        console.log('✓ OpenAI client initialized from encrypted config');
      } else {
        console.warn('⚠️  Failed to decrypt API key. User will need to reconfigure.');
      }
    } catch (error) {
      console.warn('⚠️  Failed to initialize OpenAI client:', error.message);
    }
  } else {
    console.log('⚠️  No OpenAI API key found. User will need to configure it.');
  }
}

initializeApp();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Check if OpenAI API key is configured
app.get('/api/check-config', (req, res) => {
  res.json({
    success: true,
    hasApiKey: !!config.encryptedApiKey,
    isInitialized: !!openaiClient
  });
});

// Initialize OpenAI with API key and save it encrypted
app.post('/api/init-openai', async (req, res) => {
  try {
    const { apiKey, saveKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }

    openaiClient = new OpenAI({ apiKey });

    // Test the API key
    await openaiClient.models.list();

    // Save the API key encrypted if requested
    if (saveKey) {
      const encryptedKey = encrypt(apiKey);
      config.encryptedApiKey = encryptedKey;
      await saveConfig();
      console.log('✓ OpenAI API key encrypted and saved to config');
    }

    res.json({ success: true, saved: !!saveKey });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Upload and transcribe audio
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!openaiClient) {
      return res.status(400).json({ success: false, error: 'OpenAI not initialized' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file uploaded' });
    }

    const audioPath = req.file.path;

    // Transcribe using Whisper
    const transcription = await openaiClient.audio.transcriptions.create({
      file: require('fs').createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    // Store audio in Firebase Storage if configured
    let audioUrl = null;
    if (storage) {
      const audioFileName = `audio/${Date.now()}_${req.file.originalname}`;
      await storage.upload(audioPath, {
        destination: audioFileName,
        metadata: { contentType: req.file.mimetype }
      });

      const file = storage.file(audioFileName);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      audioUrl = url;
    }

    // Clean up temp file
    await fs.unlink(audioPath);

    res.json({
      success: true,
      transcription,
      audioUrl
    });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Analyze transcript segments
app.post('/api/analyze-transcript', async (req, res) => {
  try {
    if (!openaiClient) {
      return res.status(400).json({ success: false, error: 'OpenAI not initialized' });
    }

    const { segments } = req.body;

    const prompt = `Analyze the following meeting transcript segments and identify which segments are work-related and which are not. For each segment, determine if it's work-related or casual/off-topic conversation.

Transcript segments:
${segments.map((seg, idx) => `[${idx}] (${seg.start}s - ${seg.end}s): ${seg.text}`).join('\n')}

Return a JSON array where each element has:
- segmentIndex: the segment index
- isWorkRelated: boolean (true if work-related, false if casual)
- topic: brief description of what this segment is about

Respond ONLY with valid JSON, no other text.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a meeting analysis assistant. Analyze transcript segments and classify them as work-related or casual conversation. Respond only with valid JSON.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    res.json({ success: true, analysis });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate summary and action items
app.post('/api/generate-summary', async (req, res) => {
  try {
    if (!openaiClient) {
      return res.status(400).json({ success: false, error: 'OpenAI not initialized' });
    }

    const { filteredTranscript } = req.body;

    const prompt = `Analyze this meeting transcript and provide:

1. A brief executive summary (2-3 sentences)
2. Key discussion points (bullet points)
3. Action items with:
   - What needs to be done
   - Who is responsible (if mentioned)
   - When it should be completed (if mentioned)
4. Main topics discussed (generate appropriate headers)

Transcript:
${filteredTranscript}

Return the response as JSON with this structure:
{
  "summary": "executive summary text",
  "keyPoints": ["point 1", "point 2", ...],
  "actionItems": [
    {
      "task": "description",
      "assignee": "person name or 'Not specified'",
      "deadline": "date or 'Not specified'"
    }
  ],
  "topics": [
    {
      "title": "topic header",
      "content": "summary of this topic discussion"
    }
  ]
}

Respond ONLY with valid JSON, no other text.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a meeting summarization assistant. Analyze meeting transcripts and extract key information, action items, and topics. Respond only with valid JSON.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });

    const summary = JSON.parse(response.choices[0].message.content);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate and save documents
app.post('/api/generate-documents', async (req, res) => {
  try {
    const { title, date, dateObject, participants, summary, keyPoints, topics, actionItems, transcriptLines } = req.body;

    // Format document titles
    const summaryTitle = `${date} – ${title} – Summary`;
    const transcriptTitle = `${date} – ${title} – Transcript`;

    // Generate Summary Document
    const summaryDoc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: summaryTitle,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun({ text: `Date: ${dateObject}`, bold: true })],
            spacing: { after: 200 }
          }),
          new Paragraph({
            text: 'Participants',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 100, after: 100 }
          }),
          ...participants.map(participant =>
            new Paragraph({
              text: participant,
              bullet: { level: 0 },
              spacing: { after: 50 }
            })
          ),
          new Paragraph({
            text: 'Executive Summary',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 }
          }),
          new Paragraph({
            text: summary,
            spacing: { after: 300 }
          }),
          new Paragraph({
            text: 'Key Points',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          ...keyPoints.map(point =>
            new Paragraph({
              text: point,
              bullet: { level: 0 },
              spacing: { after: 100 }
            })
          ),
          new Paragraph({
            text: 'Discussion Topics',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 }
          }),
          ...topics.flatMap(topic => [
            new Paragraph({
              text: topic.title,
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 150, after: 100 }
            }),
            new Paragraph({
              text: topic.content,
              spacing: { after: 200 }
            })
          ]),
          new Paragraph({
            text: 'Action Items',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 }
          }),
          ...actionItems.map((action, idx) =>
            new Paragraph({
              children: [
                new TextRun({ text: `${idx + 1}. `, bold: true }),
                new TextRun({ text: `${action.task}` }),
                new TextRun({ text: ` - Assignee: ${action.assignee}`, italics: true }),
                action.deadline !== 'Not specified' ? new TextRun({ text: ` - Due: ${action.deadline}`, italics: true }) : new TextRun({ text: '' })
              ],
              spacing: { after: 100 }
            })
          )
        ]
      }]
    });

    // Generate Transcript Document
    const transcriptDoc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: transcriptTitle,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun({ text: `Date: ${dateObject}`, bold: true })],
            spacing: { after: 300 }
          }),
          new Paragraph({
            text: 'Full Transcript',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          ...transcriptLines.map(line =>
            new Paragraph({
              children: [
                new TextRun({ text: `[${line.speaker}] `, bold: true, color: '4A5568' }),
                new TextRun({ text: line.text })
              ],
              spacing: { after: 150 }
            })
          )
        ]
      }]
    });

    // Generate buffers
    const summaryBuffer = await Packer.toBuffer(summaryDoc);
    const transcriptBuffer = await Packer.toBuffer(transcriptDoc);

    // Save to Firebase Storage if configured
    if (storage) {
      const summaryFileName = `documents/${summaryTitle}.docx`;
      const transcriptFileName = `documents/${transcriptTitle}.docx`;

      // Upload summary
      const summaryFile = storage.file(summaryFileName);
      await summaryFile.save(summaryBuffer, {
        metadata: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      });

      // Upload transcript
      const transcriptFile = storage.file(transcriptFileName);
      await transcriptFile.save(transcriptBuffer, {
        metadata: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      });

      // Get download URLs
      const [summaryUrl] = await summaryFile.getSignedUrl({ action: 'read', expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      const [transcriptUrl] = await transcriptFile.getSignedUrl({ action: 'read', expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });

      // Save meeting data to Firestore
      if (db) {
        await db.collection('meetings').add({
          title,
          date: dateObject,
          participants,
          summary,
          keyPoints,
          topics,
          actionItems,
          summaryUrl,
          transcriptUrl,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      res.json({
        success: true,
        summaryUrl,
        transcriptUrl,
        summaryFileName: `${summaryTitle}.docx`,
        transcriptFileName: `${transcriptTitle}.docx`
      });
    } else {
      // Fallback: save locally and send files
      const summaryPath = path.join(__dirname, 'temp-output', `${summaryTitle}.docx`);
      const transcriptPath = path.join(__dirname, 'temp-output', `${transcriptTitle}.docx`);

      await fs.writeFile(summaryPath, summaryBuffer);
      await fs.writeFile(transcriptPath, transcriptBuffer);

      res.json({
        success: true,
        summaryPath,
        transcriptPath,
        message: 'Documents saved locally. Configure Firebase for cloud storage.'
      });
    }
  } catch (error) {
    console.error('Document generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download document endpoint
app.get('/api/download/:type/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, 'temp-output', filename);

    res.download(filePath, filename, async (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      // Clean up file after download
      try {
        await fs.unlink(filePath);
      } catch (e) {
        console.error('File cleanup error:', e);
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    firebaseConfigured: !!storage,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Meeting Minutes Web App running on http://localhost:${PORT}`);
  console.log(`📝 Open your browser and navigate to http://localhost:${PORT}\n`);

  if (!storage) {
    console.warn('⚠️  Firebase not configured - using local file storage');
    console.warn('   Add firebase-config/serviceAccountKey.json to enable cloud storage\n');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
