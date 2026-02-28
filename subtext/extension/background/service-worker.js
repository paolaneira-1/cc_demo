// Subtext - Background Service Worker
// Handles API calls, context menus, and message routing

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Subtext — a brutally honest, brilliantly sharp corporate BS translator. You think like a brilliant friend who has read every business book, survived every startup, and has zero patience for jargon.

Your job: analyze corporate text and return the unvarnished truth in JSON.

DETECT THE CATEGORY automatically:
- "investor-email": fundraising updates, investor memos, founder updates, VC correspondence
- "job-posting": job descriptions, role postings, hiring ads
- "linkedin-post": LinkedIn-style thought leadership, humble brags, professional inspiration
- "performance-review": employee reviews, self-assessments, feedback forms, PIPs
- "other": anything else corporate-flavored

RETURN ONLY valid JSON matching this exact schema (no markdown, no preamble, no explanation):

{
  "category": "investor-email" | "job-posting" | "linkedin-post" | "performance-review" | "other",
  "bs_score": <0-100, where 0=painfully honest, 100=pure vaporware>,
  "one_liner": "<one brutal honest sentence, MAX 15 words, no hedging>",
  "translations": [
    {
      "original": "<exact phrase or sentence from the text>",
      "decoded": "<what it actually means>",
      "severity": "mild" | "spicy" | "nuclear"
    }
  ],
  "honest_rewrite": "<rewrite the whole thing as if written by a pathologically honest person>",
  "the_reply_you_want": "<the reply the reader actually wants to send but won't>"
}

CATEGORY-SPECIFIC FIELDS — include ONLY for the matching category:

For "investor-email", also include:
  "archetype": one of these investor email archetypes:
    - "The Reframe" (bad news buried in good framing)
    - "The Metric Cherry-Pick" (highlighting only the green numbers)
    - "The Pivot Disguise" (calling a 180° turn a 'strategic evolution')
    - "The Hockey Stick Tease" (growth is 'just around the corner')
    - "The Humble Brag Board" (dropping advisor names like lifeboats)
    - "The Runway Minimizer" (18 months of runway sounds fine... right?)
    - "The Vision Smoke Screen" (market size = our actual results)
    - "The Controlled Burn" (we ran out of money but make it sound intentional)

For "job-posting", also include:
  "survival_probability": <0-100, chance a normal human survives 6 months in this role>

For "linkedin-post", also include:
  "cringe_score": <0-100, where 100=needs to be deleted immediately>

TONE RULES:
- Be funny but precise. Every decoded translation must be TRUE.
- The one_liner should sting a little.
- translations: pick 3-6 of the most egregious phrases. If the text is short, pick 1-3.
- honest_rewrite should be SHORT (2-5 sentences max) and devastatingly accurate.
- the_reply_you_want should be something the reader would fantasize about sending.
- Do not moralize. Just translate.
- If the text is genuinely not corporate BS, say so (bs_score under 20, honest acknowledgment).

SEVERITY GUIDE:
- "mild": standard corporate fuzziness (synergy, alignment, bandwidth)
- "spicy": deliberate obfuscation or spin (challenges = we're failing, passionate = we won't pay you enough)
- "nuclear": outright deception, legal weasel words, or deeply manipulative framing

Return ONLY the JSON object. Nothing else.`;

// ─── Install: Set Up Context Menu ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "subtext-translate",
    title: "Translate with Subtext",
    contexts: ["selection"],
  });

  console.log("[Subtext] Extension installed. Context menu created.");
});

// ─── Context Menu Click Handler ───────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "subtext-translate") return;
  if (!info.selectionText || info.selectionText.trim().length < 10) return;

  const text = info.selectionText.trim();

  // Open the side panel
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error("[Subtext] Failed to open side panel:", err);
  }

  // Small delay to let the side panel mount before streaming starts
  setTimeout(() => {
    analyzeText(text, tab.id);
  }, 600);
});

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? null;

  switch (message.type) {
    case "ANALYZE_TEXT": {
      const text = (message.text || "").trim();
      if (!text) {
        sendResponse({ success: false, error: "No text provided" });
        return false;
      }

      // Open side panel if we have a tab context
      if (tabId !== null) {
        chrome.sidePanel.open({ tabId }).catch((err) => {
          console.warn("[Subtext] Could not open side panel:", err);
        });
      }

      // Delay analysis so the side panel has time to mount and attach its listener
      setTimeout(() => analyzeText(text, tabId), 750);
      sendResponse({ success: true });
      return false;
    }

    case "OPEN_PANEL": {
      if (tabId !== null) {
        chrome.sidePanel
          .open({ tabId })
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            console.error("[Subtext] Failed to open side panel:", err);
            sendResponse({ success: false, error: err.message });
          });
        return true; // Keep channel open for async response
      }
      sendResponse({ success: false, error: "No tab context" });
      return false;
    }

    case "GET_API_KEY": {
      chrome.storage.sync.get(["apiKey"], (result) => {
        sendResponse({ apiKey: result.apiKey || null });
      });
      return true; // Keep channel open
    }

    case "SAVE_API_KEY": {
      const key = (message.apiKey || "").trim();
      if (!key) {
        sendResponse({ success: false, error: "Empty API key" });
        return false;
      }
      chrome.storage.sync.set({ apiKey: key }, () => {
        sendResponse({ success: true });
      });
      return true;
    }

    default:
      return false;
  }
});

// ─── Core Analysis Function ───────────────────────────────────────────────────

async function analyzeText(text, tabId) {
  // Retrieve API key
  let apiKey;
  try {
    const result = await chrome.storage.sync.get(["apiKey"]);
    apiKey = result.apiKey;
  } catch (err) {
    broadcastToSidePanel({ type: "ERROR", error: "Could not read storage: " + err.message }, tabId);
    return;
  }

  if (!apiKey || apiKey.trim() === "") {
    broadcastToSidePanel({ type: "NO_API_KEY" }, tabId);
    return;
  }

  // Signal that analysis is starting
  broadcastToSidePanel({ type: "ANALYSIS_START", text }, tabId);

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Translate this corporate text:\n\n${text}`,
      },
    ],
    stream: true,
  };

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    broadcastToSidePanel(
      { type: "ERROR", error: "Network error: " + err.message },
      tabId
    );
    return;
  }

  if (!response.ok) {
    let errorText = `API error ${response.status}`;
    try {
      const errBody = await response.json();
      errorText = errBody?.error?.message || errorText;
    } catch (_) {}

    if (response.status === 401) {
      broadcastToSidePanel({ type: "INVALID_API_KEY", error: errorText }, tabId);
    } else {
      broadcastToSidePanel({ type: "ERROR", error: errorText }, tabId);
    }
    return;
  }

  // Stream the response
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        let parsed;
        try {
          parsed = JSON.parse(trimmed.slice(6));
        } catch (_) {
          continue;
        }

        // Handle different event types from Anthropic streaming
        if (parsed.type === "content_block_delta") {
          const delta = parsed.delta?.text || "";
          if (delta) {
            fullText += delta;
            broadcastToSidePanel({ type: "STREAM_DELTA", delta }, tabId);
          }
        } else if (parsed.type === "message_start") {
          // Input token count available here if needed
        } else if (parsed.type === "message_delta") {
          // Output token count available here if needed
        } else if (parsed.type === "message_stop") {
          // Stream complete
        } else if (parsed.type === "error") {
          const errMsg = parsed.error?.message || "Streaming error";
          broadcastToSidePanel({ type: "ERROR", error: errMsg }, tabId);
          return;
        }
      }
    }
  } catch (err) {
    broadcastToSidePanel(
      { type: "ERROR", error: "Stream read error: " + err.message },
      tabId
    );
    return;
  }

  // Parse and validate the full JSON result
  let result;
  try {
    // Strip any accidental markdown fences
    const cleaned = fullText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    result = JSON.parse(cleaned);
  } catch (err) {
    broadcastToSidePanel(
      {
        type: "ERROR",
        error: "Failed to parse response JSON. Raw: " + fullText.slice(0, 200),
      },
      tabId
    );
    return;
  }

  // Validate required fields
  const requiredFields = ["category", "bs_score", "one_liner", "translations", "honest_rewrite", "the_reply_you_want"];
  const missing = requiredFields.filter((f) => !(f in result));
  if (missing.length > 0) {
    broadcastToSidePanel(
      { type: "ERROR", error: `Response missing fields: ${missing.join(", ")}` },
      tabId
    );
    return;
  }

  // Success — send the complete parsed result
  broadcastToSidePanel({ type: "ANALYSIS_COMPLETE", result }, tabId);
}

// ─── Broadcast Helper ─────────────────────────────────────────────────────────

/**
 * Sends a message to the side panel.
 * Since MV3 service workers can't directly target the side panel by tab,
 * we broadcast to all extension pages and let the side panel filter.
 */
function broadcastToSidePanel(message, tabId) {
  const payload = { ...message, tabId };

  // Send to all extension views (side panel, popup, options)
  chrome.runtime.sendMessage(payload).catch((err) => {
    // Side panel might not be open yet — that's fine
    if (!err.message?.includes("Could not establish connection") &&
        !err.message?.includes("No tab with id")) {
      console.warn("[Subtext] broadcastToSidePanel error:", err.message);
    }
  });
}
