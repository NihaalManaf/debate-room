import express from 'express';
import OpenAI from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors({ origin: true, credentials: true }));

// Use JSON parser for all routes except webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

app.use(express.static(join(__dirname, 'public')));

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Supabase Admin (Service Role) to update user profiles securely
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Need this env var for admin access
);

// Supabase config endpoint (exposes public keys to frontend)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// Profile endpoint - uses service role to bypass RLS
app.get('/api/profile/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Profile fetch error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Return profile or default free status
    res.json(data || { id: userId, is_premium: false });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create OpenRouter client (server-side only)
function getOpenAI() {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:3000',
      'X-Title': 'Debate Room',
    }
  });
}

// Startup debate prompts - deep, responsive, non-repetitive
const ADVOCATE_SYSTEM = `You're the ADVOCATE arguing why this startup will succeed.

CRITICAL RULES:
1. NEVER repeat points you've already made in previous rounds
2. DIRECTLY address the skeptic's last argument - quote them and counter
3. Each round, bring ONE new angle with specific evidence
4. Use real numbers, real companies, real data when possible
5. If you've mentioned a company before (like Duolingo), don't mention it again
6. NEVER ASSUME ANYTHING about the startup that isn't explicitly confirmed in the "User Clarifications" section. 
7. If a detail is missing (e.g., pricing, features), you MUST NOT invent it. Instead, either avoid the point or use a question: "How do you plan to handle X?"
8. You are forbidden from arguing with hallucinations. If you claim they have "10k users" and it's not in the clarifications, you have failed.
9. If you need to make an argument about an unconfirmed area, use strict hypotheticals: "Supposing there is a tiered pricing model..." or "Assuming the team has technical expertise..."

Structure each response:
- First: Directly counter the skeptic's last point (if any)
- Then: ONE fresh argument you haven't made before

New angles to explore (use different ones each round):
- Specific customer segments and their pain points
- Pricing strategy and willingness to pay
- Distribution channels and partnerships
- Team and execution capability
- Defensibility and network effects
- Regulatory advantages
- Technology moats

Keep it punchy. 2-3 sentences per point. No fluff.

CLARIFICATIONS:
If the user's input (startup idea + clarifications) is too vague to form a specific argument, you can ASK for clarification instead of arguing.
Format: <clarification>What is the specific target market?</clarification>
Only do this if you ABSOLUTELY cannot proceed without more info.

Format:
<thinking>What did skeptic just say? How do I counter? What NEW point can I make?</thinking>
<output>Your response - be specific, be fresh, don't repeat yourself</output>
OR (only if genuinely confused):
<clarification>Your question here</clarification>`;

const SKEPTIC_SYSTEM = `You're the SKEPTIC arguing why this startup will fail.

CRITICAL RULES:
1. NEVER repeat points you've already made in previous rounds
2. DIRECTLY address the advocate's last argument - quote them and counter
3. Each round, bring ONE new angle with specific evidence
4. Use real numbers, real failures, real market data when possible
5. If you've mentioned a competitor before (like Khan Academy), don't mention it again
6. NEVER ASSUME ANYTHING about the startup that isn't explicitly confirmed in the "User Clarifications" section. 
7. If a detail is missing (e.g., pricing, features), you MUST NOT invent it. Instead, either avoid the point or use a question/attack: "What is the plan for X?"
8. You are forbidden from arguing with hallucinations. If you claim they have "10k users" and it's not in the clarifications, you have failed.
9. If you need to make an argument about an unconfirmed area, use strict hypotheticals: "Without a clear pricing model..." or "If they haven't secured funding..."

Structure each response:
- First: Directly counter the advocate's last point
- Then: ONE fresh attack angle you haven't used before

New angles to explore (use different ones each round):
- Specific unit economics problems (CAC, LTV, margins)
- Churn and retention challenges
- Regulatory or legal risks
- Technical feasibility issues
- Team gaps or execution risks
- Market timing problems (too early/late)
- Channel conflicts
- Pricing power limitations

Keep it punchy. 2-3 sentences per point. No fluff.

CLARIFICATIONS:
If the user's input (startup idea + clarifications) is too vague to form a specific attack, you can ASK for clarification instead of arguing.
Format: <clarification>What is the specific target market?</clarification>
Only do this if you ABSOLUTELY cannot proceed without more info.

Format:
<thinking>What did advocate just say? How do I counter? What NEW attack can I make?</thinking>
<output>Your response - be specific, be fresh, don't repeat yourself</output>
OR (only if genuinely confused):
<clarification>Your question here</clarification>`;

const JUDGE_SYSTEM = `You're the JUDGE - a seasoned investor who's seen thousands of pitches.

Your job: Evaluate the QUALITY of arguments, not just who yelled louder.

Consider:
- Who made specific, evidence-backed points vs vague claims?
- Who actually responded to the other's arguments vs just repeated themselves?
- Who identified real risks/opportunities vs generic talking points?
- Which concerns were legitimate? Which were overblown?

Be honest. If both sides were weak, say so. If one side made a killer point the other never addressed, highlight it.

Format:
<thinking>Analyzing the strongest and weakest points from each side...</thinking>
<output>
## Best Points Made

**Advocate's strongest argument:**
[The one point that really landed, and why]

**Skeptic's strongest argument:**
[The one concern that's genuinely hard to dismiss]

## Weakest Moments

**Advocate's weakest moment:**
[Where they dodged or made empty claims]

**Skeptic's weakest moment:**
[Where they were unfair or missed the mark]

## The Verdict

**Winner: [Advocate/Skeptic]**
[2-3 sentences on why - be specific about which argument won it]

## My Investment Take

**Should this get funded?** [Yes/No/Maybe with conditions]
[Honest 2-3 sentence recommendation - what would need to be true for this to work?]
</output>`;

// Discovery Phase prompts - ask questions, don't argue
const ADVOCATE_DISCOVERY = `You're the ADVOCATE helping evaluate a startup idea.

This is the DISCOVERY PHASE. Your job is to ASK QUESTIONS - not make arguments yet.

Ask 2-3 questions that will help you build a strong case FOR the startup:
- What unique advantages or strengths do they have?
- What traction, team, or technology exists?
- What's the pricing model or revenue potential?

Format your response as a JSON array of questions:
{
  "questions": [
    "Question 1 about their strengths...",
    "Question 2 about their advantages...",
    "Question 3 about their potential..."
  ]
}

Be friendly and curious. These questions help the founder clarify their pitch.`;

const SKEPTIC_DISCOVERY = `You're the SKEPTIC helping stress-test a startup idea.

This is the DISCOVERY PHASE. Your job is to ASK QUESTIONS - not make arguments yet.

Ask 2-3 questions that probe potential weaknesses or risks:
- What's the competition like? Who else is doing this?
- What's the go-to-market strategy?
- What are the biggest risks or unknowns?

Format your response as a JSON array of questions:
{
  "questions": [
    "Question 1 about risks...",
    "Question 2 about competition...",
    "Question 3 about challenges..."
  ]
}

Be direct but fair. These questions help identify blind spots.`;

// Store conversation history for debates
const debates = new Map();

app.post('/api/start-debate', async (req, res) => {
  const { idea, files } = req.body;
  const debateId = Date.now().toString();

  // Process files to create context
  let fileContext = '';
  if (files && files.length > 0) {
    const fileDescriptions = files.map(f => {
      if (f.type === 'image') {
        return `[Attached image: ${f.name}]\nDescription: ${f.content}`;
      } else if (f.type === 'pdf') {
        return `[Attached PDF: ${f.name}]\nContent: ${f.content}`;
      } else if (f.type === 'text') {
        return `[Attached text file: ${f.name}]\nContent: ${f.content}`;
      }
      return '';
    }).filter(Boolean);

    if (fileDescriptions.length > 0) {
      fileContext = '\n\n--- Supporting Materials ---\n' + fileDescriptions.join('\n\n');
    }
  }

  debates.set(debateId, {
    idea,
    files: files || [],
    fileContext,
    history: [],
    round: 0
  });

  res.json({ debateId, idea });
});

// Pre-debate clarification - asks questions BEFORE making any assumptions
app.post('/api/analyze-idea', async (req, res) => {
  const { idea, files } = req.body;
  const client = getOpenAI();

  if (!client) {
    return res.status(500).json({ error: 'Server is not configured with OPENROUTER_API_KEY' });
  }

  // Build file context if any
  let fileContext = '';
  if (files && files.length > 0) {
    const fileDescriptions = files.map(f => {
      if (f.type === 'image') {
        return `[Attached image: ${f.name}]\nDescription: ${f.content}`;
      } else if (f.type === 'pdf') {
        return `[Attached PDF: ${f.name}]\nContent: ${f.content}`;
      } else if (f.type === 'text') {
        return `[Attached text file: ${f.name}]\nContent: ${f.content}`;
      }
      return '';
    }).filter(Boolean);

    if (fileDescriptions.length > 0) {
      fileContext = '\n\n--- Supporting Materials ---\n' + fileDescriptions.join('\n\n');
    }
  }

  try {
    console.log('🔍 Analyzing idea for clarification:', idea);

    const analyzePrompt = `Analyze if this startup idea is understandable enough to debate.
    
IDEA: "${idea}"${fileContext}

RULE: Return empty questions array UNLESS the idea is just a single ambiguous word/name with NO description.

Examples - return {"questions": []}:
- "AI tutoring platform" ✓ clear
- "Food delivery app" ✓ clear
- "AI platform that teaches students" ✓ clear

Examples - ask ONE question:
- "rubberduck" → ask what it is
- "moonshot" → ask what it is

If ANY descriptive words exist (platform, app, service, tool, AI, teaching, etc.), the idea is clear enough.

Respond JSON only:
{
  "questions": [],
  "reasoning": "Idea provides sufficient context about [problem/solution]..."
}
OR
{
  "questions": [{"claim": "unknown product", "question": "What is [name]?"}],
  "reasoning": "Idea is only a single name with no description"
}`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that identifies what needs clarification about a startup idea. Always respond with valid JSON only. Be thoughtful - only ask for genuinely missing critical information.' },
        { role: 'user', content: analyzePrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{"questions": []}');
    console.log('🔍 Pre-debate analysis result:', result);
    if (result.reasoning) {
      console.log('🤔 Analysis reasoning:', result.reasoning);
    }
    res.json(result);
  } catch (error) {
    console.error('Pre-debate analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze image using GPT-4 Vision
app.post('/api/analyze-image', async (req, res) => {
  const { imageData, context } = req.body;
  const client = getOpenAI();

  if (!client) {
    return res.status(500).json({ error: 'Server is not configured with OPENROUTER_API_KEY' });
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this image in the context of a startup idea. Describe what you see that's relevant for evaluating the business concept. Be specific about any charts, mockups, diagrams, or data shown. Keep it concise (2-3 sentences).${context ? `\n\nContext: ${context}` : ''}`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageData,
                detail: 'low'
              }
            }
          ]
        }
      ],
      max_tokens: 300
    });

    const description = response.choices[0]?.message?.content || 'Could not analyze image';
    res.json({ description });
  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze image' });
  }
});

// Fact-checking endpoint - checks if response contains unsupported claims
app.post('/api/check-facts', async (req, res) => {
  const { debateId, draftResponse, idea, fileContext: clientFileContext, role } = req.body;
  const roleLabel = role === 'advocate' ? 'Advocate' : 'Skeptic';

  console.log('🔍 Fact-check request for debate:', debateId, 'Role:', role);

  // Try to get debate from map, or use provided context
  let debate = debates.get(debateId);
  if (!debate && idea) {
    // Create a temporary context if debate not in map but idea provided
    debate = { idea, fileContext: clientFileContext || '' };
  }

  if (!debate) {
    console.log('❌ Debate not found:', debateId);
    return res.status(404).json({ error: 'Debate not found' });
  }

  const client = getOpenAI();
  if (!client) {
    return res.status(500).json({ error: 'Server is not configured with OPENROUTER_API_KEY' });
  }

  try {
    const fileContext = debate.fileContext || '';
    const availableContext = `Startup idea: "${debate.idea}"${fileContext}`;

    // Include already-confirmed clarifications so we don't re-ask
    const confirmedClarifications = debate.clarifications || [];
    const confirmedContext = confirmedClarifications.length > 0
      ? '\n\nALREADY CONFIRMED BY FOUNDER:\n' + confirmedClarifications.map(c => `- ${c.question}: "${c.answer}"`).join('\n')
      : '';

    console.log(`📋 Fact-checking [${roleLabel}] draft response...`);

    const factCheckPrompt = `You are a strict investor fact-checking a debater's claims about a startup.

DRAFT ARGUMENT:
"${draftResponse}"

KNOWN CONTEXT:
${availableContext}${confirmedContext}

YOUR GOAL:
Identify internal proprietary claims about the startup that require verification from the founder.

STRICT RULES:
1. IGNORE logical arguments, business critiques, market data, and external citations (e.g., "McKinsey says...", "Figma did X").
2. MUST FLAG any specific proprietary "facts" about this startup's internal reality that are not in the Known Context. This includes:
   - Specific founders/team members (e.g., "CTO from OpenAI").
   - Funding and Revenue (e.g., "$5M seed", "$100k ARR").
   - User numbers and Traction (e.g., "50k users", "Partnered with Sequoia").
   - Specific internal technical components (e.g., "We use Pinecone").
3. If a claim is just general (e.g., "The idea has potential"), IGNORE it.
4. For any proprietary claim, ask a deep, evaluative question.

Return JSON format: 
{
  "clarifications": [
    { "claim": "The ${roleLabel} says: ...", "question": "..." }
  ]
}
If no proprietary claims, return { "clarifications": [] }.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a strict fact-checker. You MUST NOT ask questions about information already confirmed in the "Confirmed Clarifications" section. If a claim is consistent with confirmed info, it is NOT a hallucination. Always respond with valid JSON only.' },
        { role: 'user', content: factCheckPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{"clarifications": []}');
    console.log('📋 Fact-check result:', result);
    res.json(result);
  } catch (error) {
    console.error('Fact-check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Discovery endpoint - asks questions from both sides simultaneously
app.post('/api/discovery', async (req, res) => {
  const { idea, files } = req.body;
  const client = getOpenAI();

  if (!client) {
    return res.status(500).json({ error: 'Server is not configured with OPENROUTER_API_KEY' });
  }

  // Build context from files if any
  let fileContext = '';
  if (files && files.length > 0) {
    fileContext = '\n\n--- Context from Files ---\n' + files.map(f => f.content).join('\n\n');
  }

  try {
    // Call both Advocate and Skeptic in parallel
    const [advocateRes, skepticRes] = await Promise.race([
      Promise.all([
        client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: ADVOCATE_DISCOVERY },
            { role: 'user', content: `Startup idea: "${idea}"${fileContext}` }
          ],
          response_format: { type: 'json_object' }
        }),
        client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SKEPTIC_DISCOVERY },
            { role: 'user', content: `Startup idea: "${idea}"${fileContext}` }
          ],
          response_format: { type: 'json_object' }
        })
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Discovery timeout')), 30000))
    ]);

    const advocateQuestions = JSON.parse(advocateRes.choices[0]?.message?.content || '{"questions": []}').questions || [];
    const skepticQuestions = JSON.parse(skepticRes.choices[0]?.message?.content || '{"questions": []}').questions || [];

    // Combine and deduplicate questions while preserving role
    const uniqueQuestions = [];
    const seen = new Set();

    const processQuestions = (questions, role) => {
      for (const q of questions) {
        const normalized = q.toLowerCase().replace(/[?.,]/g, '').trim();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          uniqueQuestions.push({ question: q, role });
        }
      }
    };

    processQuestions(advocateQuestions, 'Advocate');
    processQuestions(skepticQuestions, 'Skeptic');

    // Map to the format the frontend modal expects
    const clarifications = uniqueQuestions.map(item => ({
      claim: `Founder Question`,
      question: item.question
    }));

    res.json({ clarifications });
  } catch (error) {
    console.error('Discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/debate-turn', async (req, res) => {
  const { debateId, role, previousArgument, clarifications, model } = req.body;

  console.log(`\n📝 [${role.toUpperCase()}] Turn requested for debate ${debateId}`);

  const debate = debates.get(debateId);
  if (!debate) {
    console.log(`❌ Debate ${debateId} not found`);
    return res.status(404).json({ error: 'Debate not found' });
  }

  const systemPrompt = role === 'advocate' ? ADVOCATE_SYSTEM : SKEPTIC_SYSTEM;

  // Build context with previous arguments to prevent repetition (limit to last 8)
  const myPreviousArgs = debate.history
    .filter(h => h.role === role)
    .slice(-8)  // Last 8 arguments for better memory
    .map((h, i) => `- ${(h.output || h.content).substring(0, 300)}...`)
    .join('\n');

  // Include file context if available
  const fileContext = debate.fileContext || '';

  // Handle clarifications - prevent duplicates
  if (clarifications && clarifications.length > 0) {
    // Only add clarifications that aren't already stored (based on the question text)
    const existingQuestions = new Set((debate.clarifications || []).map(c => c.question));
    const newClarifications = clarifications.filter(c => !existingQuestions.has(c.question));

    if (newClarifications.length > 0) {
      debate.clarifications = [...(debate.clarifications || []), ...newClarifications];
    }
  }

  let clarificationText = '';
  if (debate.clarifications && debate.clarifications.length > 0) {
    clarificationText = '\n\n--- Confirmed Clarifications ---\n' +
      debate.clarifications.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n\n');
  }

  let userMessage;
  if (debate.history.length === 0) {
    userMessage = `Startup idea: "${debate.idea}"${fileContext}${clarificationText}

Make your opening argument.`;
  } else {
    userMessage = `Startup idea: "${debate.idea}"${fileContext}${clarificationText}

Your recent points (don't repeat):
${myPreviousArgs || 'None yet'}

Opponent just said:
"${previousArgument}"

Counter their point. Add ONE new argument.`;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Server-side OpenRouter only
  const client = getOpenAI();
  if (!client) {
    res.write(`data: ${JSON.stringify({ error: 'Server is not configured with OPENROUTER_API_KEY', done: true })}\n\n`);
    res.end();
    return;
  }

  try {
    const debateModel = model || 'gpt-4o-mini';
    const instructions = req.body.instructions;

    // Add user instructions to system prompt if provided
    let finalSystemPrompt = systemPrompt;
    if (instructions && instructions.trim()) {
      finalSystemPrompt += `\n\nUSER GUIDANCE FOR THIS TURN:\n${instructions}`;
    }

    console.log(`🚀 [${role.toUpperCase()}] Calling OpenAI API (${debateModel})...`);
    // console.log(`DEBUG: User Message: ${userMessage.substring(0, 500)}...`);

    const completion = await client.chat.completions.create({
      model: debateModel,
      messages: [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: false, // Turn off streaming initially to check for clarifications
      max_tokens: 800
    });

    const fullResponse = completion.choices[0]?.message?.content || '';
    console.log(`🤖 [${role.toUpperCase()}] LLM responded with ${fullResponse.length} characters.`);

    // Check for clarification request
    const clarificationMatch = fullResponse.match(/<clarification>([\s\S]*?)<\/clarification>/);
    if (clarificationMatch) {
      console.log(`❓ [${role.toUpperCase()}] Requesting clarification: ${clarificationMatch[1]}`);
      // Send a distinct event for clarification
      res.json({
        needsClarification: true,
        question: clarificationMatch[1],
        role: role
      });
      return;
    }

    // If no clarification, stream it back like a normal response (simulated stream for compatibility)
    // Or just convert to stream since frontend expects SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Simulate streaming the already-received response
    const chunkSize = 20;
    for (let i = 0; i < fullResponse.length; i += chunkSize) {
      const chunk = fullResponse.substring(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ content: chunk, done: false })}\n\n`);
      await new Promise(r => setTimeout(r, 10)); // Tiny delay for effect
    }

    console.log(`✅ [${role.toUpperCase()}] Response complete: ${fullResponse.length} chars`);

    // Log first 300 chars of response to debug format issues
    console.log(`📄 [${role.toUpperCase()}] Response preview: ${fullResponse.substring(0, 300)}...`);

    // Check for empty or problematic responses
    if (fullResponse.length < 20) {
      console.warn(`⚠️ [${role.toUpperCase()}] Very short response: "${fullResponse}"`);
    }

    // Extract just the output (without thinking tags) for history
    const outputMatch = fullResponse.match(/<output>([\s\S]*?)(<\/output>|$)/);
    const outputOnly = outputMatch ? outputMatch[1].trim() : fullResponse;

    if (!outputOnly) {
      console.warn(`⚠️ [${role.toUpperCase()}] No <output> tag found in response`);
      console.warn(`Full response was: ${fullResponse}`);
    } else {
      console.log(`📤 [${role.toUpperCase()}] Output extracted: ${outputOnly.length} chars`);
    }

    // Store in history
    debate.history.push({
      role,
      content: fullResponse,
      output: outputOnly
    });
    debate.round++;

    res.write(`data: ${JSON.stringify({ content: '', done: true, fullResponse })}\n\n`);
    res.end();

  } catch (error) {
    console.error(`❌ [${role.toUpperCase()}] OpenAI API error:`, error.message);
    console.error('Full error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
    res.end();
  }
});

// Judge endpoint - evaluates the debate and declares a winner
app.post('/api/judge', async (req, res) => {
  const { debateId, advocateArguments, skepticArguments, idea } = req.body;

  // Get idea from debate or directly from request (for loaded past debates)
  const debate = debates.get(debateId);
  const debateIdea = debate?.idea || idea;

  if (!debateIdea) {
    return res.status(400).json({ error: 'Debate idea is required' });
  }

  // Limit to last 10 rounds to avoid context overflow
  const maxRounds = 10;
  const recentAdvocate = advocateArguments.slice(-maxRounds);
  const recentSkeptic = skepticArguments.slice(-maxRounds);
  const totalRounds = Math.max(advocateArguments.length, skepticArguments.length);

  const userMessage = `The startup idea: "${debateIdea}"

Total rounds debated: ${totalRounds}
(Showing last ${Math.min(maxRounds, totalRounds)} rounds for evaluation)

## Advocate's Arguments:
${recentAdvocate.map((arg, i) => `${arg}`).join('\n\n---\n\n')}

## Skeptic's Arguments:
${recentSkeptic.map((arg, i) => `${arg}`).join('\n\n---\n\n')}

Evaluate the debate quality and pick a winner.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Server-side OpenRouter only
  const client = getOpenAI();
  if (!client) {
    res.write(`data: ${JSON.stringify({ error: 'Server is not configured with OPENROUTER_API_KEY', done: true })}\n\n`);
    res.end();
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userMessage }
      ],
      stream: true,
      max_tokens: 1500
    });

    let fullResponse = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ content: '', done: true, fullResponse })}\n\n`);
    res.end();

  } catch (error) {
    console.error('OpenAI API error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
    res.end();
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY });
});

// ==========================================
// STRIPE INTEGRATION
// ==========================================

// Create Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  const { userId, email } = req.body;
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

  if (!userId || !email) {
    return res.status(400).json({ error: 'Missing user information' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, // Use Price ID from Product Catalog
          quantity: 1,
        },
      ],
      metadata: {
        userId: userId,
      },
      customer_email: email,
      success_url: `${clientUrl}/?success=true`,
      cancel_url: `${clientUrl}/?canceled=true`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe Webhook (Must use raw body)
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata.userId;

    console.log(`💰 Payment success for user: ${userId}`);

    // Update user profile in Supabase
    try {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ is_premium: true })
        .eq('id', userId);

      if (error) {
        console.error('Failed to update Supabase profile:', error);
      } else {
        console.log('✅ User upgraded to Premium');
      }
    } catch (dbError) {
      console.error('Database error during webhook:', dbError);
    }
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚖️ The Debate Room running at http://localhost:${PORT}`);
  if (!process.env.OPENROUTER_API_KEY) console.log('⚠️  Warning: OPENROUTER_API_KEY not set in .env file');
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('⚠️  Warning: STRIPE_SECRET_KEY not set in .env file');
  }
});
