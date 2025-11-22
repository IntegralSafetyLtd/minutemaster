# Quick Start Guide

## Prerequisites

Before running the app, make sure you have:

1. **Node.js installed** (v16 or higher)
   - Check with: `node --version`
   - Download from: https://nodejs.org/

2. **OpenAI API Key**
   - Sign up at: https://platform.openai.com/
   - Create API key at: https://platform.openai.com/api-keys
   - Add credits to your account (minimum $5 recommended)

3. **Microphone**
   - Connect a microphone or use your computer's built-in mic
   - Test in your system settings first

## Installation

Open a terminal/command prompt in this directory and run:

```bash
npm install
```

## Running the App

```bash
npm start
```

Or for development mode with DevTools:

```bash
npm run dev
```

## First Time Setup

1. **Enter API Key**: When the app launches, enter your OpenAI API key
2. **Select Microphone**: Choose the microphone(s) you want to use
3. **Start Recording**: You're ready to record your first meeting!

## Typical Workflow

1. **Record** → Click "Start Recording" before your meeting begins
2. **Stop** → Click "Stop Recording" when the meeting ends
3. **Review** → Check the transcription and filter out non-work segments
4. **Identify** → Optionally label speakers
5. **Export** → Review the summary and export to Word document

## Tips

- **Test First**: Do a quick test recording to verify everything works
- **Internet Required**: The app needs internet for AI transcription and analysis
- **Check Costs**: Monitor your OpenAI usage at https://platform.openai.com/usage
- **Save Regularly**: Audio files are auto-saved, but export important meetings right away
- **Privacy**: All processing happens via OpenAI's API - read their privacy policy

## Troubleshooting

### App won't start
```bash
# Delete node_modules and reinstall
rm -rf node_modules
npm install
npm start
```

### Microphone not detected
- Check system permissions
- Restart the app
- Try a different microphone

### API errors
- Verify API key is correct
- Check OpenAI account has credits
- Ensure internet connection

### Recording quality issues
- Position microphone closer to speakers
- Reduce background noise
- Test different microphones

## Cost Estimation

For a typical 1-hour meeting:
- Transcription (Whisper): ~$0.36
- Analysis (GPT-4): ~$0.10-0.50
- **Total: ~$0.50-1.00 per hour**

## Need Help?

- Check the full README.md for detailed information
- Visit OpenAI docs: https://platform.openai.com/docs
- Check Electron docs: https://www.electronjs.org/docs

## Next Steps

Once you're comfortable with the basic workflow:
- Experiment with speaker identification
- Try different meeting types (formal vs. casual)
- Review the generated action items for accuracy
- Customize the meeting title for better organization

Happy meeting recording!
