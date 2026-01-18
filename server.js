import express from 'express';
import OpenAI from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Supabase config endpoint (exposes public keys to frontend)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// Create OpenAI client with the provided API key
function getOpenAI(apiKey) {
  // Use provided key or fall back to env
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) return null;

  return new OpenAI({
    apiKey: key
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

Format:
<thinking>What did skeptic just say? How do I counter? What NEW point can I make?</thinking>
<output>Your response - be specific, be fresh, don't repeat yourself</output>`;

const SKEPTIC_SYSTEM = `You're the SKEPTIC arguing why this startup will fail.

CRITICAL RULES:
1. NEVER repeat points you've already made in previous rounds
2. DIRECTLY address the advocate's last argument - quote them and counter
3. Each round, bring ONE new angle with specific evidence
4. Use real numbers, real failures, real market data when possible
5. If you've mentioned a competitor before (like Khan Academy), don't mention it again

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

Format:
<thinking>What did advocate just say? How do I counter? What NEW attack can I make?</thinking>
<output>Your response - be specific, be fresh, don't repeat yourself</output>`;

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

  const apiKey = req.headers['x-api-key'];
  const client = getOpenAI(apiKey);

  if (!client) {
    return res.status(400).json({ error: 'OpenAI API key required' });
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
- "SaaS for project management" ✓ clear
- "Subscription box for pets" ✓ clear
- "Platform connecting freelancers with clients" ✓ clear

Examples - ask ONE question:
- "rubberduck" → ask what it is
- "moonshot" → ask what it is
- "xyz" → ask what it is

If ANY descriptive words exist (platform, app, service, tool, AI, teaching, etc.), the idea is clear enough.

Respond JSON only:
{"questions": []} or {"questions": [{"claim": "unknown product", "question": "What is [name]?"}]}`;

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
    res.json(result);
  } catch (error) {
    console.error('Pre-debate analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze image using GPT-4 Vision
app.post('/api/analyze-image', async (req, res) => {
  const { imageData, context } = req.body;

  const apiKey = req.headers['x-api-key'];
  const client = getOpenAI(apiKey);

  if (!client) {
    return res.status(400).json({ error: 'OpenAI API key required' });
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
  const { debateId, draftResponse, idea, fileContext: clientFileContext } = req.body;

  console.log('🔍 Fact-check request for debate:', debateId);

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

  const apiKey = req.headers['x-api-key'];
  const client = getOpenAI(apiKey);
  if (!client) {
    return res.status(400).json({ error: 'OpenAI API key required' });
  }

  try {
    const fileContext = debate.fileContext || '';
    const availableContext = `Startup idea: "${debate.idea}"${fileContext}`;

    console.log('📋 Fact-checking draft response...');

    const factCheckPrompt = `You are helping a founder clarify their startup idea.

STARTUP IDEA PROVIDED:
${availableContext}

DRAFT ARGUMENT:
${draftResponse}

YOUR TASK:
Check if the argument makes assumptions about THE FOUNDER'S OWN STARTUP that aren't in their description.

ONLY FLAG assumptions about the startup itself:
✓ Business model or pricing (e.g., "the subscription costs $X/month")
✓ Target customers (e.g., "targeting enterprise clients")  
✓ How the product works (e.g., "using machine learning to...")
✓ Team or company details (e.g., "the team has 10 years experience")
✓ Specific features or capabilities claimed

DO NOT FLAG - these are fine to assume:
✗ Market size or industry projections
✗ General statistics or research
✗ Competitor information
✗ Industry trends
✗ Economic data

Respond with JSON:
{
  "needsClarification": true or false,
  "claim": "the specific startup assumption (if any)",
  "question": "a simple question to the founder about THEIR startup (if needsClarification is true)"
}`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful fact-checker. Always respond with valid JSON only. Be proactive about identifying assumptions that should be verified.' },
        { role: 'user', content: factCheckPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');
    console.log('📋 Fact-check result:', result);
    res.json(result);
  } catch (error) {
    console.error('Fact-check error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/debate-turn', async (req, res) => {
  const { debateId, role, previousArgument, clarifications } = req.body;

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

  // Include any clarifications provided by the user
  let clarificationText = '';
  if (clarifications && clarifications.length > 0) {
    clarificationText = '\n\n--- User Clarifications ---\n' +
      clarifications.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n\n');
    // Store clarifications in debate for future turns
    debate.clarifications = [...(debate.clarifications || []), ...clarifications];
  }

  // Include previous clarifications
  if (debate.clarifications && debate.clarifications.length > 0) {
    clarificationText = '\n\n--- User Clarifications ---\n' +
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

  // Get API key from header or env
  const apiKey = req.headers['x-api-key'];
  const client = getOpenAI(apiKey);
  if (!client) {
    res.write(`data: ${JSON.stringify({ error: 'OpenAI API key not provided. Please enter your API key.', done: true })}\n\n`);
    res.end();
    return;
  }

  try {
    console.log(`🚀 [${role.toUpperCase()}] Calling OpenAI API...`);

    const stream = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: true,
      max_tokens: 800
    });

    let fullResponse = '';
    let chunkCount = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      chunkCount++;
      res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
    }

    console.log(`✅ [${role.toUpperCase()}] Response complete: ${chunkCount} chunks, ${fullResponse.length} chars`);

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

  // Get API key from header or env
  const apiKey = req.headers['x-api-key'];
  const client = getOpenAI(apiKey);
  if (!client) {
    res.write(`data: ${JSON.stringify({ error: 'OpenAI API key not provided. Please enter your API key.', done: true })}\n\n`);
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
  res.json({ status: 'ok', hasApiKey: !!process.env.OPENAI_API_KEY });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚖️ The Debate Room running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  Warning: OPENAI_API_KEY not set in .env file');
  }
});
