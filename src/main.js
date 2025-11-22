const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const OpenAI = require('openai');
const FormData = require('form-data');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

let mainWindow;
let openaiClient;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile('src/renderer/index.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Initialize OpenAI client
ipcMain.handle('init-openai', async (event, apiKey) => {
  try {
    openaiClient = new OpenAI({ apiKey });
    // Test the API key with a simple request
    await openaiClient.models.list();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Save audio file
ipcMain.handle('save-audio', async (event, audioBuffer, filename) => {
  try {
    const documentsPath = app.getPath('documents');
    const meetingMinutesPath = path.join(documentsPath, 'MeetingMinutes');

    // Create directory if it doesn't exist
    try {
      await fs.access(meetingMinutesPath);
    } catch {
      await fs.mkdir(meetingMinutesPath, { recursive: true });
    }

    const filePath = path.join(meetingMinutesPath, filename);
    await fs.writeFile(filePath, Buffer.from(audioBuffer));

    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Transcribe audio using OpenAI Whisper
ipcMain.handle('transcribe-audio', async (event, audioFilePath) => {
  try {
    if (!openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const transcription = await openaiClient.audio.transcriptions.create({
      file: require('fs').createReadStream(audioFilePath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    return { success: true, transcription };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Analyze transcript with GPT-4 to filter conversations
ipcMain.handle('analyze-transcript', async (event, segments) => {
  try {
    if (!openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

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
    return { success: true, analysis };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Generate summary and action items
ipcMain.handle('generate-summary', async (event, filteredTranscript) => {
  try {
    if (!openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

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
    return { success: true, summary };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Identify speakers using GPT-4
ipcMain.handle('identify-speakers', async (event, segments, voiceLabels) => {
  try {
    if (!openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    // Create a mapping of segment patterns to speaker names
    const prompt = `Given these voice labels provided by the user:
${Object.entries(voiceLabels).map(([segmentIdx, name]) => `Segment ${segmentIdx}: ${name}`).join('\n')}

And these transcript segments:
${segments.map((seg, idx) => `[${idx}]: ${seg.text}`).join('\n')}

Analyze the content and speaking patterns to assign speaker names to all segments. Use context clues like pronouns, addressing others, and topic continuity to determine who is speaking in each segment.

Return a JSON array where each element has:
- segmentIndex: the segment index
- speaker: the identified speaker name

Respond ONLY with valid JSON, no other text.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a speaker identification assistant. Use provided voice labels and context to identify speakers throughout a transcript. Respond only with valid JSON.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    });

    const speakerMap = JSON.parse(response.choices[0].message.content);
    return { success: true, speakerMap };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Generate Word documents (Summary and Transcript)
ipcMain.handle('generate-documents', async (event, meetingData) => {
  try {
    const { title, date, dateObject, participants, summary, keyPoints, topics, actionItems, transcriptLines, exportFormats } = meetingData;

    const result = {
      success: false,
      summaryPath: null,
      transcriptPath: null,
      pdfPaths: {}
    };

    // Format document titles
    const summaryTitle = `${date} – ${title} – Summary`;
    const transcriptTitle = `${date} – ${title} – Transcript`;

    // --- SUMMARY DOCUMENT ---
    const summaryDoc = new Document({
      sections: [{
        properties: {},
        children: [
          // Title
          new Paragraph({
            text: summaryTitle,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 }
          }),

          // Date
          new Paragraph({
            children: [
              new TextRun({
                text: `Date: ${dateObject}`,
                bold: true
              })
            ],
            spacing: { after: 200 }
          }),

          // Participants (3 columns)
          new Paragraph({
            text: 'Participants',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 100, after: 100 }
          }),

          // Create participants in a simple list (docx doesn't easily support columns)
          ...participants.map((participant, idx) =>
            new Paragraph({
              text: participant,
              bullet: { level: 0 },
              spacing: { after: 50 }
            })
          ),

          // Executive Summary
          new Paragraph({
            text: 'Executive Summary',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 }
          }),
          new Paragraph({
            text: summary,
            spacing: { after: 300 }
          }),

          // Key Points
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

          // Discussion Topics
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

          // Action Items
          new Paragraph({
            text: 'Action Items',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 }
          }),

          ...actionItems.map((action, idx) =>
            new Paragraph({
              children: [
                new TextRun({
                  text: `${idx + 1}. `,
                  bold: true
                }),
                new TextRun({
                  text: `${action.task}`
                }),
                new TextRun({
                  text: ` - Assignee: ${action.assignee}`,
                  italics: true
                }),
                action.deadline !== 'Not specified' ? new TextRun({
                  text: ` - Due: ${action.deadline}`,
                  italics: true
                }) : new TextRun({ text: '' })
              ],
              spacing: { after: 100 }
            })
          )
        ]
      }]
    });

    // --- TRANSCRIPT DOCUMENT ---
    const transcriptDoc = new Document({
      sections: [{
        properties: {},
        children: [
          // Title
          new Paragraph({
            text: transcriptTitle,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 }
          }),

          // Date
          new Paragraph({
            children: [
              new TextRun({
                text: `Date: ${dateObject}`,
                bold: true
              })
            ],
            spacing: { after: 300 }
          }),

          // Full Transcript (line by line with speakers)
          new Paragraph({
            text: 'Full Transcript',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),

          ...transcriptLines.map(line =>
            new Paragraph({
              children: [
                new TextRun({
                  text: `[${line.speaker}] `,
                  bold: true,
                  color: '4A5568'
                }),
                new TextRun({
                  text: line.text
                })
              ],
              spacing: { after: 150 }
            })
          )
        ]
      }]
    });

    // Generate Word documents
    if (exportFormats.word) {
      const summaryBuffer = await Packer.toBuffer(summaryDoc);
      const transcriptBuffer = await Packer.toBuffer(transcriptDoc);

      // Get save location from user
      const dialogResult = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Folder to Save Documents',
        properties: ['openDirectory', 'createDirectory']
      });

      if (!dialogResult.canceled && dialogResult.filePaths.length > 0) {
        const saveDir = dialogResult.filePaths[0];

        // Save Summary
        const summaryPath = path.join(saveDir, `${summaryTitle}.docx`);
        await fs.writeFile(summaryPath, summaryBuffer);
        result.summaryPath = summaryPath;

        // Save Transcript
        const transcriptPath = path.join(saveDir, `${transcriptTitle}.docx`);
        await fs.writeFile(transcriptPath, transcriptBuffer);
        result.transcriptPath = transcriptPath;

        result.success = true;
      } else {
        return { success: false, error: 'Save cancelled' };
      }
    }

    // Generate PDFs if requested
    if (exportFormats.pdf && result.summaryPath && result.transcriptPath) {
      try {
        const { PDFLib } = require('pdf-lib');

        // Note: Converting DOCX to PDF requires LibreOffice or similar
        // For now, we'll inform the user that PDF export requires manual conversion
        // or additional setup. A full implementation would require:
        // 1. Installing LibreOffice/MS Office
        // 2. Using a library like docx-pdf or officegen
        // 3. Or using a cloud service API

        result.pdfNote = 'PDF generation requires additional setup. Please use a tool like LibreOffice to convert the Word documents to PDF, or use "Print to PDF" in Microsoft Word.';

      } catch (error) {
        result.pdfError = error.message;
      }
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});
