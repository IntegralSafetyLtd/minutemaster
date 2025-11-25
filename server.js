require('dotenv').config();

const express = require('express');
const https = require('https');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const OpenAI = require('openai');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const admin = require('firebase-admin');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { encrypt, decrypt, validateCrypto } = require('./crypto-utils');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CONFIG_FILE = path.join(__dirname, 'config.json');
const SALT_ROUNDS = 12; // bcrypt salt rounds for password hashing

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

// Session management
app.use(session({
  secret: process.env.SESSION_SECRET || 'minutemaster-secret-key-' + require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

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

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Authentication required' });
}

// User management functions
async function createUser(email, password) {
  if (!db) {
    throw new Error('Database not configured');
  }

  // Hash password with bcrypt
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const userData = {
    email,
    passwordHash,
    encryptedApiKey: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastLogin: null
  };

  const userRef = await db.collection('users').add(userData);
  console.log(`✓ User created: ${email}`);

  return { id: userRef.id, email };
}

async function findUserByEmail(email) {
  if (!db) {
    throw new Error('Database not configured');
  }

  const snapshot = await db.collection('users')
    .where('email', '==', email)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function updateUserApiKey(userId, encryptedApiKey) {
  if (!db) {
    throw new Error('Database not configured');
  }

  await db.collection('users').doc(userId).update({
    encryptedApiKey,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function updateLastLogin(userId) {
  if (!db) {
    throw new Error('Database not configured');
  }

  await db.collection('users').doc(userId).update({
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Check authentication status
app.get('/api/auth/status', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({
      success: true,
      authenticated: true,
      email: req.session.userEmail
    });
  } else {
    res.json({
      success: true,
      authenticated: false
    });
  }
});

// User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    // Find user
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Update last login
    await updateLastLogin(user.id);

    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;

    // Initialize OpenAI client if user has API key
    if (user.encryptedApiKey) {
      const apiKey = decrypt(user.encryptedApiKey);
      if (apiKey) {
        openaiClient = new OpenAI({ apiKey });
      }
    }

    res.json({
      success: true,
      email: user.email,
      hasApiKey: !!user.encryptedApiKey
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// User logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    openaiClient = null;
    res.json({ success: true });
  });
});

// Check if OpenAI API key is configured for current user
app.get('/api/check-config', requireAuth, async (req, res) => {
  try {
    const user = await db.collection('users').doc(req.session.userId).get();
    const userData = user.data();

    res.json({
      success: true,
      hasApiKey: !!userData.encryptedApiKey,
      isInitialized: !!openaiClient
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Initialize OpenAI with API key and save it encrypted (requires authentication)
app.post('/api/init-openai', requireAuth, async (req, res) => {
  try {
    const { apiKey, saveKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }

    openaiClient = new OpenAI({ apiKey });

    // Test the API key
    await openaiClient.models.list();

    // Save the API key encrypted to user's account if requested
    if (saveKey) {
      const encryptedKey = encrypt(apiKey);
      await updateUserApiKey(req.session.userId, encryptedKey);
      console.log(`✓ OpenAI API key encrypted and saved for user: ${req.session.userEmail}`);
    }

    res.json({ success: true, saved: !!saveKey });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Upload and transcribe audio (requires authentication)
app.post('/api/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  let audioPath = null;
  let convertedPath = null;

  try {
    if (!openaiClient) {
      return res.status(400).json({ success: false, error: 'OpenAI not initialized' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file uploaded' });
    }

    audioPath = req.file.path;
    // Multer files don't have extensions, so append .mp3 instead of replacing
    convertedPath = audioPath + '.mp3';

    console.log('Converting audio from', audioPath, 'to', convertedPath);

    // Convert WebM to MP3 for better compatibility with OpenAI
    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .toFormat('mp3')
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .on('end', () => {
          console.log('Audio conversion complete');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg conversion error:', err);
          reject(err);
        })
        .save(convertedPath);
    });

    // Transcribe using Whisper
    console.log('Starting transcription...');
    const transcription = await openaiClient.audio.transcriptions.create({
      file: fsSync.createReadStream(convertedPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    console.log('Transcription complete');

    // Store audio in Firebase Storage if configured
    let audioUrl = null;
    let storedAudioPath = convertedPath; // Keep the MP3 for speaker identification

    if (storage) {
      const audioFileName = `audio/${Date.now()}_recording.mp3`;
      await storage.upload(convertedPath, {
        destination: audioFileName,
        metadata: { contentType: 'audio/mpeg' }
      });

      const file = storage.file(audioFileName);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      audioUrl = url;
    }

    // Clean up original WebM file but keep MP3 for speaker identification
    if (audioPath) await fs.unlink(audioPath).catch(() => {});
    // Don't delete convertedPath yet - we need it for speaker identification

    res.json({
      success: true,
      transcription,
      audioUrl,
      audioFilePath: storedAudioPath // Send path for speaker extraction
    });
  } catch (error) {
    console.error('Transcription error:', error);

    // Clean up temp files on error
    if (audioPath) await fs.unlink(audioPath).catch(() => {});
    if (convertedPath) await fs.unlink(convertedPath).catch(() => {});

    res.status(500).json({ success: false, error: error.message });
  }
});

// Analyze transcript segments (requires authentication)
app.post('/api/analyze-transcript', requireAuth, async (req, res) => {
  try {
    if (!openaiClient) {
      return res.status(400).json({ success: false, error: 'OpenAI not initialized' });
    }

    const { segments } = req.body;

    const prompt = `Analyze the following meeting transcript segments and provide:
1. Classify each segment as work-related or casual
2. Identify any self-introductions (e.g., "Hi, I'm John", "My name is Sarah", "This is David speaking")

Transcript segments:
${segments.map((seg, idx) => `[${idx}] (${seg.start}s - ${seg.end}s): ${seg.text}`).join('\n')}

Return a JSON object with:
{
  "segments": [
    {
      "segmentIndex": number,
      "isWorkRelated": boolean,
      "topic": "brief description",
      "speakerIntroduction": "name" or null (if someone introduces themselves)
    }
  ],
  "detectedSpeakers": [
    {
      "name": "speaker name from introduction",
      "segmentIndex": number where they introduced themselves
    }
  ]
}

Respond ONLY with valid JSON, no other text.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a meeting analysis assistant. Analyze transcript segments, classify them, and identify speaker introductions. Respond only with valid JSON.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    res.json({ success: true, analysis: analysis.segments, detectedSpeakers: analysis.detectedSpeakers || [] });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Extract speaker audio snippets (requires authentication)
app.post('/api/extract-speaker-snippets', requireAuth, async (req, res) => {
  try {
    const { audioPath, segments } = req.body;

    if (!audioPath || !segments || segments.length === 0) {
      return res.status(400).json({ success: false, error: 'Audio path and segments required' });
    }

    // Group segments by speaker similarity (using time gaps to identify potential speaker changes)
    // For now, we'll sample every 30 seconds or at segment boundaries
    const speakerSamples = [];
    const sampleDuration = 5; // 5 seconds per sample
    let lastSampleTime = 0;
    const minGapBetweenSamples = 15; // 15 seconds minimum gap

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Only create a sample if enough time has passed
      if (segment.start - lastSampleTime >= minGapBetweenSamples) {
        const sampleStart = segment.start;
        const sampleEnd = Math.min(segment.start + sampleDuration, segment.end);

        speakerSamples.push({
          sampleIndex: speakerSamples.length,
          segmentIndex: i,
          startTime: sampleStart,
          endTime: sampleEnd,
          text: segment.text.substring(0, 100) + (segment.text.length > 100 ? '...' : '')
        });

        lastSampleTime = sampleStart;

        // Limit to 8 samples to avoid overwhelming the user
        if (speakerSamples.length >= 8) break;
      }
    }

    // Return the sample metadata - audio extraction will happen on demand
    res.json({
      success: true,
      speakerSamples
    });
  } catch (error) {
    console.error('Speaker snippet extraction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific speaker audio sample
app.post('/api/get-speaker-audio', requireAuth, async (req, res) => {
  try {
    const { audioFile, startTime, endTime } = req.body;

    if (!audioFile || startTime === undefined || endTime === undefined) {
      return res.status(400).json({ success: false, error: 'Audio file and timestamps required' });
    }

    // Create temp output path for the snippet
    const snippetPath = path.join(__dirname, 'temp-output', `speaker_${Date.now()}.mp3`);

    // Extract audio snippet using FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(audioFile)
        .setStartTime(startTime)
        .setDuration(endTime - startTime)
        .output(snippetPath)
        .audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Read the snippet and send as base64
    const audioBuffer = await fs.readFile(snippetPath);
    const audioBase64 = audioBuffer.toString('base64');

    // Clean up
    await fs.unlink(snippetPath);

    res.json({
      success: true,
      audioData: `data:audio/mpeg;base64,${audioBase64}`
    });
  } catch (error) {
    console.error('Get speaker audio error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate summary and action items (requires authentication)
app.post('/api/generate-summary', requireAuth, async (req, res) => {
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

// Generate and save documents (requires authentication)
app.post('/api/generate-documents', requireAuth, async (req, res) => {
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

// Start servers (both HTTP and HTTPS)
app.listen(PORT, () => {
  console.log(`\n🚀 Meeting Minutes Web App running on:`);
  console.log(`   HTTP:  http://localhost:${PORT}`);
});

// Start HTTPS server
try {
  const sslOptions = {
    key: fsSync.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
    cert: fsSync.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
  };

  https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
    console.log(`   HTTPS: https://localhost:${HTTPS_PORT}`);
    console.log(`\n📱 For mobile access, use: https://[your-pc-ip]:${HTTPS_PORT}`);
    console.log(`   (You'll need to accept the security warning on first visit)\n`);

    if (!storage) {
      console.warn('⚠️  Firebase not configured - using local file storage');
      console.warn('   Add firebase-config/serviceAccountKey.json to enable cloud storage\n');
    }
  });
} catch (error) {
  console.warn('⚠️  HTTPS not available - SSL certificates not found');
  console.warn('   HTTPS is required for mobile microphone access');
  console.warn('   Generate certificates or use HTTP on localhost only\n');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
