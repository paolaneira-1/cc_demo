/**
 * Sends the two demo emails to paula@spinlink.io via Resend.
 *
 * Email 1: Performance review from Jordan Ellis (H1 Feedback Path Forward)
 * Email 2: Investor pass from Alex Chen (ACME Inc Following up)
 *
 * Usage: node send_demo_emails.js
 */

const RESEND_API_KEY = 're_XrS2wdwk_9CQc3xEAKRR88G92FEEM4MJN';
const FROM = 'hello@app.spinlink.io';
const TO = 'paula@spinlink.io';

async function sendEmail({ from, fromName, to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: `${fromName} <${from}>`, to, subject, html }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Resend error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ── Email 1: Performance review ───────────────────────────────────────────────

const perfReviewHtml = `
<p>Hi Paola,</p>

<p>I wanted to reach out after our quarterly sync to share some thoughts on H1 and set the right foundation going into the back half of the year.</p>

<p>First - I want to acknowledge the energy and commitment you've brought to the team. Your work on the ACME Inc client onboarding has been genuinely strong, and the cross-functional collaboration you led in Q2 stood out to leadership.</p>

<p>That said, I think it's important we have an honest conversation. There are a few areas where expectations and outputs haven't fully aligned over the past quarter, and I'd like for us to treat this as a reset moment for both of us - a chance to get really clear on priorities, support structures, and what success looks like in your role going forward.</p>

<p>To make that concrete, I'd like to propose a 60-day alignment plan. This isn't about performance management - it's about making sure you have the clarity and resources to do your best work. I'll draft something by end of week and we can walk through it together.</p>

<p>Really committed to making this work. Let's find time to connect this week.</p>

<p>
Jordan Ellis<br>
Head of People, ACME Inc
</p>
`;

// ── Email 2: Investor pass ────────────────────────────────────────────────────

const investorPassHtml = `
<p>Hi Paola,</p>

<p>Thank you for walking me through what you're building at ACME Inc - I really enjoyed the conversation and it's clear you and the team have been thinking hard about the problem.</p>

<p>After discussion internally, we've decided not to move forward at this stage. The metrics aren't quite where we need them to be for us to get conviction right now, and if I'm being transparent, the market dynamics in this space are shifting quickly enough that it's hard for us to develop a clear point of view at the moment.</p>

<p>None of this is a reflection on the team - you're sharp and clearly mission-driven. These calls are never easy to make.</p>

<p>Would love to reconnect when you hit your milestones. Please do keep me in the loop as things develop.</p>

<p>Rooting for you.</p>

<p>
Alex Chen<br>
Partner, Peak Ventures<br>
alex@peakventures.com
</p>
`;

// ── Send both ─────────────────────────────────────────────────────────────────

async function run() {
  console.log('Sending demo emails to', TO, '...\n');

  try {
    const r1 = await sendEmail({
      from: FROM,
      fromName: 'Jordan Ellis',
      to: TO,
      subject: 'H1 Feedback Path Forward',
      html: perfReviewHtml,
    });
    console.log('Email 1 sent (performance review):', r1.id);
  } catch (err) {
    console.error('Email 1 failed:', err.message);
  }

  try {
    const r2 = await sendEmail({
      from: FROM,
      fromName: 'Alex Chen',
      to: TO,
      subject: 'ACME Inc Following up',
      html: investorPassHtml,
    });
    console.log('Email 2 sent (investor pass):', r2.id);
  } catch (err) {
    console.error('Email 2 failed:', err.message);
  }

  console.log('\nDone. Check paula@spinlink.io inbox.');
}

run();
