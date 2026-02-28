#!/bin/bash
set -e

# ----------------------------------------------------------------
# Subtext Demo — Master Recording Script
# Usage: ANTHROPIC_API_KEY=sk-ant-... bash record_demo.sh
# ----------------------------------------------------------------

VIDEO_DIR="/Users/paolaneira/Documents/thinking_machines/demo/video"
RAW_VIDEO="$VIDEO_DIR/raw_recording.mp4"
VOICEOVER="$VIDEO_DIR/voiceover_draft.mp3"
FINAL_VIDEO="$VIDEO_DIR/subtext_demo_final.mp4"

# Load keys from .env file in same directory
ENV_FILE="$(dirname "$0")/.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY not set. Add it to video/.env"
  exit 1
fi

echo "============================================"
echo " SUBTEXT DEMO RECORDER"
echo "============================================"
echo ""

# ----------------------------------------------------------------
# Step 0: Start local HTTP server for investor_email.html
# (Chrome extensions can't inject into file:// URLs by default)
# ----------------------------------------------------------------
echo "Step 0: Clearing stale Playwright profile..."
rm -rf /tmp/subtext-demo-profile
echo ""

echo "Step 0b: Starting local HTTP server on port 8765..."
python3 -m http.server 8765 --directory "$VIDEO_DIR" \
  >/tmp/http_server.log 2>&1 &
HTTP_PID=$!
sleep 1
echo "HTTP server started (PID: $HTTP_PID)"
echo ""

# ----------------------------------------------------------------
# Step 1: Start screen recording
# ----------------------------------------------------------------
echo "Step 1: Starting screen recording..."
echo "(Recording Capture screen 0 — device index 3 on this Mac)"
echo ""

ffmpeg \
  -f avfoundation \
  -framerate 30 \
  -i "3:none" \
  -vcodec libx264 \
  -preset ultrafast \
  -pix_fmt yuv420p \
  -crf 18 \
  "$RAW_VIDEO" \
  -y 2>/tmp/ffmpeg_recording.log &

FFMPEG_PID=$!
echo "Screen recording started (PID: $FFMPEG_PID)"
echo ""

# Give ffmpeg 2 seconds to start capturing
sleep 2

# ----------------------------------------------------------------
# Step 2: Run Playwright demo automation
# ----------------------------------------------------------------
echo "Step 2: Running demo automation..."
echo ""
cd "$VIDEO_DIR"
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" node demo_automation.js

echo ""
echo "Step 3: Stopping screen recording and HTTP server..."
kill $FFMPEG_PID 2>/dev/null || true
kill $HTTP_PID 2>/dev/null || true
# Wait for ffmpeg to finish writing
sleep 2

# ----------------------------------------------------------------
# Step 4: Generate voiceover if missing
# ----------------------------------------------------------------
echo ""
echo "Step 4: Combining video + voiceover..."

if [ ! -f "$VOICEOVER" ]; then
  echo "Voiceover not found, generating with ElevenLabs (Sarah voice)..."
  VOICEOVER_TEXT=$(sed '/^\[BEAT/d; /^\[REAL WORLD/d; /^\[OUTRO/d' \
    "$VIDEO_DIR/../voiceover_script_v2.txt" | \
    tr '\n' ' ' | sed 's/  */ /g; s/^ //; s/ $//')

  python3 -c "
import json, sys
text = sys.stdin.read().strip()
payload = {
    'text': text,
    'model_id': 'eleven_multilingual_v2',
    'voice_settings': {
        'stability': 0.40,
        'similarity_boost': 0.75,
        'style': 0.30,
        'use_speaker_boost': True
    }
}
print(json.dumps(payload))
" <<< "$VOICEOVER_TEXT" | \
  curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: audio/mpeg" \
    -d @- \
    -o "$VOICEOVER"
  echo "Voiceover generated."
fi

# ----------------------------------------------------------------
# Step 5: Combine video + voiceover
# ----------------------------------------------------------------
ffmpeg \
  -i "$RAW_VIDEO" \
  -i "$VOICEOVER" \
  -c:v copy \
  -c:a aac \
  -b:a 192k \
  -map 0:v:0 \
  -map 1:a:0 \
  -shortest \
  "$FINAL_VIDEO" \
  -y

echo ""
echo "============================================"
echo " DONE!"
echo " Final video: $FINAL_VIDEO"
echo "============================================"
echo ""
echo "Open with: open \"$FINAL_VIDEO\""
