# Subtext Demo - Current Status

Last updated: 2026-03-01

## What we are building
Automated demo video of the Subtext Chrome extension. 3 scenes:
1. Performance review email (Jordan Ellis -> Paola, "H1 Feedback Path Forward")
2. Investor pass email (Alex Chen, "Spinlink Following up")
3. DoorDash job posting on Greenhouse

Script: ffmpeg records screen, Playwright drives Chrome via CDP, ElevenLabs generates
voiceover, ffmpeg combines into final MP4.

## How to run
```bash
# 1. Quit Chrome fully (Cmd+Q)
# 2. Run:
bash ~/Documents/thinking_machines/demo/video/record_demo.sh
```

## What is working
- Chrome launches via spawn + CDP using Default profile (unmanaged)
- Extension loads via --load-extension flag (service worker registers before CDP connects)
- Extension API key injected via demo-key.json (written before Chrome launches, deleted after)
- Subtext site buttons appear on Gmail emails and are clicked automatically
- Gmail search finds both emails and opens them correctly
- DoorDash Greenhouse page loads (Subtext button not yet appearing there - see pending)
- ElevenLabs voiceover generated and cached (video/voiceover_draft.mp3)
- ffmpeg screen recording working (device index 3, Capture screen 0)
- Final video produced: video/subtext_demo_final.mp4

## What is pending

### 1. Timing sync
Voiceover and screen scenes are not coordinated. The automation uses fixed sleeps
that do not align with the voiceover timestamps. Need to measure voiceover section
offsets and adjust scene durations to match.

### 2. DoorDash Greenhouse - Subtext button not appearing
The content script does not inject on boards.greenhouse.io in the current setup.
Likely a timing or selector issue. Falls back to no analysis for scene 3.

### 3. Avatar / talking head
Want a circle PIP avatar overlay (generated via D-ID or similar API) speaking
the intro and outro sections. No web UI - must be done via terminal/API only.
Audio files already exist: video/avatar_intro.mp3, video/avatar_outro.mp3.

### 4. Chrome-only recording
Currently recording full screen. Should crop to Chrome window (1280x900 at 0,0)
using ffmpeg crop filter in post, or switch to window-specific capture.

## Key file locations
- Automation:    video/demo_automation.js
- Shell script:  video/record_demo.sh
- Voiceover src: voiceover_script_v3.txt
- Voiceover mp3: video/voiceover_draft.mp3 (cached - delete to regenerate)
- Extension:     subtext/extension/
- API key shim:  subtext/extension/background/demo-key.json (written at runtime, gitignored)
- Final output:  video/subtext_demo_final.mp4

## Key constants in demo_automation.js
- CHROME_SRC_PROFILE = 'Default'  // unmanaged profile, gmail logged in as paula@spinlink.io
- CHROME_TEMP_DATA   = '/tmp/subtext-chrome-demo'
- EXTENSION_PATH     = subtext/extension
- Extension ID       = fignfifoniblkonapihmkfakmlgkbkcf
- Gmail search 1     = subject:(H1 Feedback Path Forward)
- Gmail search 2     = subject:(Spinlink Following up)
- Greenhouse         = boards.greenhouse.io/doordashusa/jobs/6786292

## API keys (in video/.env - never commit)
- ANTHROPIC_API_KEY: in video/.env
- ELEVENLABS_API_KEY: in video/.env

## GitHub repo
https://github.com/paolaneira-1/cc_demo
