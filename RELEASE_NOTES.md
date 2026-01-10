# Call-Me Cloud Release Notes

## v1.1.0 - January 2026

### New Features

#### Barge-In (Interruption) Support
Users can now interrupt Claude mid-speech by simply starting to talk. The system uses Voice Activity Detection (VAD) to detect when the user begins speaking during TTS playback and immediately:

- Stops sending TTS audio chunks
- Clears the Twilio audio buffer to prevent queued audio from playing
- Switches to listening mode to capture the user's response
- Returns an `interrupted` flag in API responses so callers know the message was cut short

This creates a much more natural conversational flow where users don't have to wait for Claude to finish speaking before responding.

**Technical Changes:**
- Added `onSpeechStart`/`onSpeechEnd` callbacks to `RealtimeSTTSession` interface
- Implemented VAD callbacks in OpenAI Realtime STT provider
- Added `isSpeaking`/`interrupted` state tracking to `CallState`
- Made `speak()`, `speakStreaming()`, and `sendAudio()` interruptible
- Added `clearAudioBuffer()` for Twilio audio buffer flush

---

### Bug Fixes

#### Regional OpenAI API Endpoint Support
Fixed issues with regionally-locked OpenAI API keys that require requests to go to regional endpoints (e.g., `us.api.openai.com`).

- Realtime STT API now uses regional endpoint when configured
- TTS API correctly uses standard endpoint (regional not required for TTS)

#### Railway/Render Deployment Compatibility
Fixed Twilio webhook signature validation failures on cloud platforms where URL reconstruction can fail due to proxy headers.

- Added automatic bypass for `.railway.app` and `.onrender.com` domains
- Added `CALLME_SKIP_SIGNATURE_VALIDATION` environment variable for custom deployments

#### Health Check Improvements
HTTP server now starts immediately on boot, before provider initialization completes. This ensures health checks pass during container startup, preventing premature restarts by orchestrators like Railway.

---

### Configuration

#### New Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CALLME_SKIP_SIGNATURE_VALIDATION` | Set to `true` to bypass Twilio webhook signature validation | `false` |

---

### Upcoming Features (In Development)

#### SMS Fallback (Pending A2P Registration)
An SMS fallback feature has been developed and is available on the `feature/sms-fallback` branch. When merged, it will:

- Automatically fall back to SMS when calls aren't answered (~25 second timeout)
- Allow users to reply via text message
- Support "call me" keyword to switch back to voice mode
- Include 7-minute inactivity timeout for SMS sessions

**Note:** This feature requires A2P 10DLC registration with Twilio for US phone numbers. The feature will be merged once campaign approval is received.

---

### API Changes

#### Response Format Updates
All call-related API responses now include an `interrupted` field:

```json
{
  "callId": "call-1-1234567890",
  "response": "User's transcribed response",
  "interrupted": true
}
```

The `interrupted` flag is `true` when the user interrupted Claude mid-speech, allowing callers to know the full message may not have been delivered.

---

### Contributors
- Claude Opus 4.5 (Co-Author)
