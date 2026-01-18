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
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

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
  const { idea } = req.body;
  const debateId = Date.now().toString();

  debates.set(debateId, {
    idea,
    history: [],
    round: 0
  });

  res.json({ debateId, idea });
});

app.post('/api/debate-turn', async (req, res) => {
  const { debateId, role, previousArgument } = req.body;

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

  let userMessage;
  if (debate.history.length === 0) {
    userMessage = `Startup idea: "${debate.idea}"

Make your opening argument.`;
  } else {
    userMessage = `Startup idea: "${debate.idea}"

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
  const { debateId, advocateArguments, skepticArguments } = req.body;

  const debate = debates.get(debateId);
  if (!debate) {
    return res.status(404).json({ error: 'Debate not found' });
  }

  // Limit to last 10 rounds to avoid context overflow
  const maxRounds = 10;
  const recentAdvocate = advocateArguments.slice(-maxRounds);
  const recentSkeptic = skepticArguments.slice(-maxRounds);
  const totalRounds = Math.max(advocateArguments.length, skepticArguments.length);

  const userMessage = `The startup idea: "${debate.idea}"

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
