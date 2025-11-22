# MinuteMaster

An AI-powered meeting minutes recorder with automatic transcription, summarization, and document generation.

## Features

- **Multi-Microphone Support**: Select and record from multiple microphones simultaneously
- **AI Transcription**: Uses OpenAI Whisper API for accurate speech-to-text
- **Content Filtering**: AI analyzes and filters work-related vs. casual conversations
- **Speaker Identification**: Assign speaker names with autocomplete
- **Meeting Participants Tracking**: List all participants in generated documents
- **Smart Summarization**: GPT-4 generates executive summaries and key points
- **Action Item Extraction**: Automatically identifies tasks, assignees, and deadlines
- **Dual Document Export**: Separate Summary and Transcript documents
- **Formatted Filenames**: `yyyy/mm/dd – Title – Type.docx`
- **Cloud Storage**: Optional Firebase integration for cloud storage
- **Secure API Key Storage**: AES-256-GCM encrypted storage of OpenAI API keys

## Requirements

- Node.js (v16 or higher)
- OpenAI API key
- Microphone(s)
- (Optional) Firebase project for cloud storage

## Installation

```bash
# Clone the repository
git clone https://github.com/IntegralSafetyLtd/minutemaster.git
cd minutemaster

# Install dependencies
npm install
```

## Configuration

### OpenAI API Key

The application will prompt for your OpenAI API key on first use. You can choose to save it securely (encrypted with AES-256-GCM) for future sessions.

### Firebase (Optional)

For cloud storage capabilities:

1. Create a Firebase project at https://console.firebase.google.com
2. Download service account key JSON
3. Save as `firebase-config/serviceAccountKey.json`
4. Enable Storage in Firebase Console

## Usage

### Start the Web Application

```bash
npm run web
```

Then open your browser to http://localhost:3000

### Start the Desktop Application (Electron)

```bash
npm start
```

## Workflow

1. **Configure API Key**: Enter your OpenAI API key (saved securely with encryption)
2. **Select Microphones**: Choose one or more microphones to record from
3. **Record Meeting**: Start/stop recording with live audio visualization
4. **Review & Filter**: AI analyzes content, filter segments to include
5. **Identify Speakers**: Assign speaker names to transcript segments
6. **Export Documents**: Generate Summary and Transcript as Word documents

## Security

- API keys are encrypted using AES-256-GCM before storage
- Machine-specific encryption keys derived from hardware identifiers
- PBKDF2 key derivation with 100,000 iterations
- Authenticated encryption with Galois/Counter Mode
- Firebase credentials stored locally (never committed to Git)

## Project Structure

```
minutemaster/
├── public/              # Web app frontend
│   ├── index.html      # UI structure
│   ├── styles.css      # Styling
│   └── app.js          # Frontend logic
├── src/                # Electron desktop app
│   ├── main.js         # Electron main process
│   └── renderer/       # Electron renderer
├── server.js           # Express web server
├── crypto-utils.js     # Encryption utilities
├── firebase-config/    # Firebase credentials (gitignored)
└── temp-uploads/       # Temporary file storage (gitignored)
```

## Technologies

- **Electron**: Cross-platform desktop application
- **Express**: Web server framework
- **OpenAI Whisper**: Speech-to-text transcription
- **OpenAI GPT-4**: Content analysis and summarization
- **Firebase**: Cloud storage and database
- **docx**: Word document generation
- **Web Audio API**: Audio recording and visualization
- **Node.js crypto**: AES-256-GCM encryption

## Cost Estimation

Approximate costs per 1-hour meeting:
- Whisper transcription: ~$0.36
- GPT-4 analysis: ~$0.10-0.50
- **Total: ~$0.50-1.00 per hour**

## Privacy & Security

- API key encrypted and stored locally
- Audio files saved to local storage or Firebase
- No data sent to external servers except OpenAI API
- Full control over which content is included in final documents
- Firebase credentials never committed to version control

## License

MIT License

## Support

For issues or questions, please visit:
https://github.com/IntegralSafetyLtd/minutemaster/issues
