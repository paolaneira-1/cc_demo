#!/bin/bash

# ----------------------------------------------------------------
# Subtext Demo — Master Recording Script
# Usage: bash record_demo.sh
# ----------------------------------------------------------------

VIDEO_DIR="/Users/paolaneira/Documents/thinking_machines/demo/video"
RAW_VIDEO="$VIDEO_DIR/raw_recording.mp4"
VOICEOVER="$VIDEO_DIR/voiceover_draft.mp3"
AVATAR_VIDEO="$VIDEO_DIR/avatar_video.mp4"
FINAL_VIDEO="$VIDEO_DIR/subtext_demo_final.mp4"

# Avatar: Alyssa, red suit, lobby — best professional female presenter
DID_PRESENTER="v2_public_Alyssa_NoHands_RedSuite_Lobby@qtzjxMSwEa"

# Composite timings (seconds)
INTRO_END=15       # avatar full screen 0→15s
OUTRO_START=123    # avatar full screen 123s→end (2:03)

# PiP bubble size and padding (pixels, in 1920x1080 output)
PIP_SIZE=220
PIP_PADDING=24

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
# Step 0: Confirm Chrome is not running
# ----------------------------------------------------------------
if pgrep -x "Google Chrome" > /dev/null; then
  echo "ERROR: Chrome is running. Quit Chrome (Cmd+Q) then re-run this script."
  exit 1
fi
echo "Step 0: Chrome not running — good."
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
  -pixel_format uyvy422 \
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
echo "Step 3: Stopping screen recording..."
kill $FFMPEG_PID 2>/dev/null || true
sleep 2

# ----------------------------------------------------------------
# Step 4: Generate voiceover if missing
# ----------------------------------------------------------------
echo ""
echo "Step 4: Checking voiceover..."

if [ -f "$VOICEOVER" ] && [ -s "$VOICEOVER" ]; then
  echo "Voiceover already exists — skipping ElevenLabs generation."
  echo "  (Delete $VOICEOVER to regenerate)"
else
  echo "Generating voiceover with ElevenLabs (Sarah voice, script v3)..."
  VOICEOVER_TEXT=$(sed \
    's/^\[BEAT[^]]*\]/<break time="1.5s"\/>/; s/^\[OUTRO\]/<break time="1.5s"\/>/; /^\[REAL WORLD/d' \
    "$VIDEO_DIR/../voiceover_script_v3.txt" | \
    tr '\n' ' ' | sed 's/  */ /g; s/^ //; s/ $//')
  VOICEOVER_TEXT="<speak>${VOICEOVER_TEXT}</speak>"

  python3 -c "
import json, sys
text = sys.stdin.read().strip()
payload = {
    'text': text,
    'model_id': 'eleven_multilingual_v2',
    'enable_ssml_parsing': True,
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
  echo "Voiceover generated: $VOICEOVER"
fi

# ----------------------------------------------------------------
# Step 4.5: Generate avatar video with D-ID (cached)
# ----------------------------------------------------------------
echo ""
echo "Step 4.5: Checking avatar video..."

if [ -f "$AVATAR_VIDEO" ] && [ -s "$AVATAR_VIDEO" ]; then
  echo "Avatar video exists — skipping D-ID generation."
  echo "  (Delete $AVATAR_VIDEO to regenerate)"
else
  if [ -z "$DID_API_KEY" ]; then
    echo "Warning: DID_API_KEY not set — skipping avatar. Output will be screen-only."
  else
    echo "Generating avatar video with D-ID (Alyssa, red suit)..."

    # Upload voiceover audio to D-ID
    echo "  Uploading voiceover to D-ID..."
    AUDIO_RESP=$(curl -s -X POST "https://api.d-id.com/audios" \
      -H "Authorization: Basic ${DID_API_KEY}" \
      -H "accept: application/json" \
      -F "audio=@${VOICEOVER}")
    AUDIO_URL=$(echo "$AUDIO_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('url',''))" 2>/dev/null)

    if [ -z "$AUDIO_URL" ]; then
      echo "  Error uploading audio to D-ID: $AUDIO_RESP"
      echo "  Skipping avatar — continuing without it."
    else
      echo "  Audio uploaded."

      # Request clip generation
      CLIP_RESP=$(curl -s -X POST "https://api.d-id.com/clips" \
        -H "Authorization: Basic ${DID_API_KEY}" \
        -H "Content-Type: application/json" \
        -H "accept: application/json" \
        -d "{
          \"presenter_id\": \"${DID_PRESENTER}\",
          \"script\": {\"type\": \"audio\", \"audio_url\": \"${AUDIO_URL}\"},
          \"config\": {\"result_format\": \"mp4\"}
        }")
      CLIP_ID=$(echo "$CLIP_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

      if [ -z "$CLIP_ID" ]; then
        echo "  Error creating D-ID clip: $CLIP_RESP"
        echo "  Skipping avatar — continuing without it."
      else
        echo "  Clip created: $CLIP_ID"
        echo "  Rendering... (2-5 minutes)"
        RESULT_URL=""
        for i in $(seq 1 60); do
          sleep 10
          STATUS_RESP=$(curl -s "https://api.d-id.com/clips/${CLIP_ID}" \
            -H "Authorization: Basic ${DID_API_KEY}")
          STATUS=$(echo "$STATUS_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
          printf "  [%ds] %s\n" $((i*10)) "$STATUS"
          if [ "$STATUS" = "done" ]; then
            RESULT_URL=$(echo "$STATUS_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('result_url',''))" 2>/dev/null)
            break
          elif [ "$STATUS" = "error" ]; then
            echo "  D-ID render error: $STATUS_RESP"
            break
          fi
        done

        if [ -n "$RESULT_URL" ]; then
          curl -s -L -o "$AVATAR_VIDEO" "$RESULT_URL"
          echo "  Avatar video saved."
        else
          echo "  D-ID did not return a result URL — skipping avatar."
        fi
      fi
    fi
  fi
fi

# ----------------------------------------------------------------
# Step 5: Composite — avatar + screen + avatar
# ----------------------------------------------------------------
echo ""
echo "Step 5: Compositing final video..."

HALF=$(( PIP_SIZE / 2 ))

if [ -f "$AVATAR_VIDEO" ] && [ -s "$AVATAR_VIDEO" ]; then
  echo "  Building composite: [avatar full] + [screen + PiP] + [avatar full]"
  ffmpeg \
    -i "$RAW_VIDEO" \
    -i "$AVATAR_VIDEO" \
    -i "$VOICEOVER" \
    -filter_complex "
      [0:v]fps=30,crop=2570:1964:0:0,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[screen_scaled];
      [1:v]fps=30,scale=1920:1080,split=3[av1][av2][av3];

      [av1]trim=0:${INTRO_END},setpts=PTS-STARTPTS[v_intro];

      [screen_scaled]trim=${INTRO_END}:${OUTRO_START},setpts=PTS-STARTPTS[v_screen_mid];
      [av2]trim=${INTRO_END}:${OUTRO_START},setpts=PTS-STARTPTS[v_pip_raw];
      [v_pip_raw]scale=${PIP_SIZE}:${PIP_SIZE},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*lte((X-${HALF})*(X-${HALF})+(Y-${HALF})*(Y-${HALF}),${HALF}*${HALF})'[v_pip_circle];
      [v_screen_mid][v_pip_circle]overlay=W-w-${PIP_PADDING}:H-h-${PIP_PADDING}[v_screen_pip];

      [av3]trim=${OUTRO_START},setpts=PTS-STARTPTS[v_outro];

      [v_intro][v_screen_pip][v_outro]concat=n=3:v=1:a=0[outv]
    " \
    -map "[outv]" \
    -map 2:a \
    -c:v libx264 -preset fast -crf 18 \
    -c:a aac -b:a 192k \
    -shortest \
    "$FINAL_VIDEO" -y
else
  echo "  No avatar video — combining screen + voiceover only."
  ffmpeg \
    -i "$RAW_VIDEO" \
    -i "$VOICEOVER" \
    -c:v copy \
    -c:a aac -b:a 192k \
    -map 0:v:0 \
    -map 1:a:0 \
    -shortest \
    "$FINAL_VIDEO" -y
fi

echo ""
echo "============================================"
echo " DONE!"
echo " Final video: $FINAL_VIDEO"
echo "============================================"
echo ""
echo "Open with: open \"$FINAL_VIDEO\""
