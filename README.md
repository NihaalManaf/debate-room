# ⚔️ AI Debate Arena

Watch two AI agents clash over your ideas! One argues **why it will succeed**, the other argues **why it might fail**.

![AI Debate Arena](https://img.shields.io/badge/AI-Debate%20Arena-purple?style=for-the-badge)

## Features

- 🎭 **Two AI Debaters** - The Advocate (pro) vs The Skeptic (against)
- 🧠 **See Their Thinking** - Watch the AI's internal reasoning process
- 💬 **Real-time Streaming** - Responses stream in live as they're generated
- 🔄 **Multi-round Debates** - Continue the debate for as many rounds as you want
- ✨ **Beautiful UI** - Modern, dark-themed debate arena

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure API Key

Copy the example environment file and add your OpenAI API key:

```bash
cp .env.example .env
```

Edit `.env` and add your API key:
```
OPENAI_API_KEY=sk-your-actual-api-key-here
```

Get an API key at: https://platform.openai.com/api-keys

### 3. Start the Server

```bash
npm start
```

### 4. Open in Browser

Navigate to: http://localhost:3000

## How It Works

1. **Enter an idea** - Any concept, startup idea, hypothesis, or decision
2. **Watch the debate** - Two AI agents take turns arguing their positions
3. **See their thinking** - Each response shows internal reasoning + final argument
4. **Continue or restart** - Keep the debate going or try a new idea

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JS
- **AI**: OpenAI GPT-4o-mini
- **Streaming**: Server-Sent Events (SSE)

## Customization

### Change the AI Model

Edit `server.js` and modify the model in the API call:

```javascript
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',  // or 'gpt-4', 'gpt-3.5-turbo', etc.
  // ...
});
```

### Adjust Debater Personalities

Modify `ADVOCATE_SYSTEM` and `SKEPTIC_SYSTEM` prompts in `server.js` to change how each debater argues.

## License

MIT

