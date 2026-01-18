// Startup Debate Room - Frontend Logic

class DebateArena {
  constructor() {
    this.debateId = null;
    this.currentRound = 0;
    this.isDebating = false;
    this.isPaused = false;
    this.lastAdvocateArgument = '';
    this.lastSkepticArgument = '';
    
    // Store all arguments for the judge
    this.advocateArguments = [];
    this.skepticArguments = [];
    
    this.init();
  }

  init() {
    // DOM Elements
    this.ideaSection = document.getElementById('ideaSection');
    this.debateLayout = document.getElementById('debateLayout');
    this.ideaInput = document.getElementById('ideaInput');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.toggleApiKeyBtn = document.getElementById('toggleApiKey');
    this.startDebateBtn = document.getElementById('startDebate');
    this.newDebateBtn = document.getElementById('newDebate');
    this.pauseDebateBtn = document.getElementById('pauseDebate');
    this.judgeDebateBtn = document.getElementById('judgeDebate');
    this.currentIdeaEl = document.getElementById('currentIdea');
    this.roundNumberEl = document.getElementById('roundNumber');
    this.debateChat = document.getElementById('debateChat');
    
    // Thinking sidebar elements
    this.thinkingEmpty = document.getElementById('thinkingEmpty');
    this.thinkingActive = document.getElementById('thinkingActive');
    this.thinkingWho = document.getElementById('thinkingWho');
    this.thinkingContent = document.getElementById('thinkingContent');
    
    // Verdict panel elements
    this.verdictPanel = document.getElementById('verdictPanel');
    this.verdictContent = document.getElementById('verdictContent');
    this.closeVerdictBtn = document.getElementById('closeVerdict');

    // Event Listeners
    this.startDebateBtn.addEventListener('click', () => this.startDebate());
    this.newDebateBtn.addEventListener('click', () => this.resetDebate());
    this.pauseDebateBtn.addEventListener('click', () => this.togglePause());
    this.judgeDebateBtn.addEventListener('click', () => this.callJudge());
    this.closeVerdictBtn.addEventListener('click', () => this.closeVerdict());
    
    // API Key toggle visibility
    this.toggleApiKeyBtn.addEventListener('click', () => {
      if (this.apiKeyInput.type === 'password') {
        this.apiKeyInput.type = 'text';
        this.toggleApiKeyBtn.textContent = '🔒';
      } else {
        this.apiKeyInput.type = 'password';
        this.toggleApiKeyBtn.textContent = '👁';
      }
    });
    
    // Save API key to localStorage when changed
    this.apiKeyInput.addEventListener('change', () => {
      if (this.apiKeyInput.value) {
        localStorage.setItem('openai_api_key', this.apiKeyInput.value);
      }
    });
    
    // Load API key from localStorage
    const savedKey = localStorage.getItem('openai_api_key');
    if (savedKey) {
      this.apiKeyInput.value = savedKey;
    }
    
    // Allow Enter to start debate
    this.ideaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.startDebate();
      }
    });
  }

  async checkHealth() {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      if (!data.hasApiKey) {
        this.showError('OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.');
      }
    } catch (error) {
      console.error('Health check failed:', error);
    }
  }

  getApiKey() {
    return this.apiKeyInput.value.trim();
  }

  async startDebate() {
    const idea = this.ideaInput.value.trim();
    if (!idea) {
      this.ideaInput.focus();
      return;
    }
    
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.showError('Please enter your OpenAI API key');
      this.apiKeyInput.focus();
      return;
    }
    
    if (!apiKey.startsWith('sk-')) {
      this.showError('Invalid API key format. It should start with "sk-"');
      this.apiKeyInput.focus();
      return;
    }

    try {
      const response = await fetch('/api/start-debate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ idea })
      });

      const data = await response.json();
      this.debateId = data.debateId;
      this.currentRound = 1;
      this.isPaused = false;
      
      // Reset argument storage
      this.advocateArguments = [];
      this.skepticArguments = [];

      // Update UI
      this.currentIdeaEl.textContent = idea;
      this.ideaSection.classList.add('hidden');
      this.debateLayout.classList.remove('hidden');
      this.roundNumberEl.textContent = this.currentRound;
      this.pauseDebateBtn.classList.remove('paused');
      this.pauseDebateBtn.textContent = '⏸';
      this.judgeDebateBtn.disabled = true;

      // Clear previous messages and verdict
      this.debateChat.innerHTML = '';
      this.verdictPanel.classList.add('hidden');
      this.resetThinkingSidebar();

      // Start the continuous debate loop
      this.runDebateLoop();

    } catch (error) {
      console.error('Failed to start debate:', error);
      this.showError('Failed to start debate. Please try again.');
    }
  }

  async runDebateLoop() {
    while (!this.isPaused && this.debateId) {
      await this.runDebateRound();
      
      // Enable judge button after first round
      if (this.advocateArguments.length > 0 && this.skepticArguments.length > 0) {
        this.judgeDebateBtn.disabled = false;
      }
      
      if (this.isPaused) break;
      
      // Longer pause between rounds to avoid rate limiting
      await this.delay(2500);
      
      this.currentRound++;
      this.roundNumberEl.textContent = this.currentRound;
    }
  }

  async runDebateRound() {
    if (this.isDebating) return;
    this.isDebating = true;

    try {
      if (this.isPaused) return;
      await this.getDebaterResponse('advocate', this.lastSkepticArgument);
      
      // 2 second pause between debaters to avoid rate limiting
      await this.delay(2000);
      
      if (this.isPaused) return;
      await this.getDebaterResponse('skeptic', this.lastAdvocateArgument);

    } catch (error) {
      console.error('Debate round failed:', error);
    } finally {
      this.isDebating = false;
    }
  }

  async getDebaterResponse(role, previousArgument) {
    const isAdvocate = role === 'advocate';
    const name = isAdvocate ? 'Advocate' : 'Skeptic';
    const icon = isAdvocate ? '✓' : '✗';

    // Show typing indicator in chat
    const typingEl = this.createTypingIndicator(role, name);
    this.debateChat.appendChild(typingEl);
    this.scrollToBottom(this.debateChat);

    // Show thinking in sidebar
    this.showThinking(role, name);

    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    messageEl.innerHTML = `
      <div class="message-header">
        <div class="message-icon">${icon}</div>
        <span class="message-name">${name}</span>
        <span class="message-round">Round ${this.currentRound}</span>
      </div>
      <div class="message-content"></div>
    `;

    try {
      const response = await fetch('/api/debate-turn', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': this.getApiKey()
        },
        body: JSON.stringify({
          debateId: this.debateId,
          role,
          previousArgument
        })
      });

      typingEl.remove();
      this.debateChat.appendChild(messageEl);

      const messageContent = messageEl.querySelector('.message-content');
      let fullText = '';
      let thinkingText = '';
      let outputText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.error) {
                throw new Error(data.error);
              }

              if (data.content) {
                fullText += data.content;
                
                const parsed = this.parseResponse(fullText);
                
                // Update thinking sidebar
                if (parsed.thinking !== thinkingText) {
                  thinkingText = parsed.thinking;
                  this.thinkingContent.innerHTML = this.formatText(thinkingText);
                }
                
                // Update message content
                if (parsed.output !== outputText) {
                  outputText = parsed.output;
                  messageContent.innerHTML = this.formatText(outputText);
                  this.scrollToBottom(this.debateChat);
                }
              }

              if (data.done) {
                // Check if we got an actual response
                if (!outputText || outputText.trim().length < 10) {
                  console.warn(`${role} returned empty or very short response`);
                  console.warn(`Full text received (${fullText.length} chars):`, fullText.substring(0, 500));
                  console.warn(`Parsed thinking (${thinkingText.length} chars):`, thinkingText.substring(0, 200));
                  console.warn(`Parsed output (${outputText.length} chars):`, outputText);
                  
                  // Try to show whatever we got
                  if (fullText.length > 20) {
                    // Use raw text as fallback
                    const cleanText = fullText.replace(/<\/?thinking>/g, '').replace(/<\/?output>/g, '').trim();
                    messageContent.innerHTML = this.formatText(cleanText);
                    outputText = cleanText; // So it gets stored
                    
                    // Still store it for the judge
                    if (role === 'advocate') {
                      this.lastAdvocateArgument = outputText;
                      this.advocateArguments.push(outputText);
                    } else {
                      this.lastSkepticArgument = outputText;
                      this.skepticArguments.push(outputText);
                    }
                  } else {
                    messageContent.innerHTML = `<p style="color: #c4553a; font-style: italic;">${name} had nothing to say... (API returned empty response)</p>`;
                  }
                } else {
                  // Store arguments for the judge
                  if (role === 'advocate') {
                    this.lastAdvocateArgument = outputText;
                    this.advocateArguments.push(outputText);
                  } else {
                    this.lastSkepticArgument = outputText;
                    this.skepticArguments.push(outputText);
                  }
                }
                
                // Clear thinking after a moment
                setTimeout(() => {
                  if (!this.isDebating) {
                    this.resetThinkingSidebar();
                  }
                }, 500);
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e);
            }
          }
        }
      }
      
      // Final check - if no output was captured at all
      if (!outputText || outputText.trim().length < 10) {
        messageContent.innerHTML = `<p style="color: #c4553a; font-style: italic;">${name} didn't respond. Retrying might help.</p>`;
      }

    } catch (error) {
      typingEl.remove();
      console.error(`${role} response failed:`, error);
      this.resetThinkingSidebar();
      
      // Show error in chat but don't crash the debate
      const errorEl = document.createElement('div');
      errorEl.className = `message ${role}`;
      errorEl.innerHTML = `
        <div class="message-header">
          <div class="message-icon" style="background: #c4553a;">!</div>
          <span class="message-name">${name}</span>
          <span class="message-round">Error</span>
        </div>
        <div class="message-content" style="color: #c4553a;">
          <p>Failed to get response: ${error.message}</p>
          <p style="font-size: 0.8rem; opacity: 0.7;">The debate will continue...</p>
        </div>
      `;
      this.debateChat.appendChild(errorEl);
    }
  }

  async callJudge() {
    if (this.advocateArguments.length === 0 || this.skepticArguments.length === 0) {
      this.showError('Need at least one round of debate before calling the judge.');
      return;
    }

    // Pause the debate
    this.isPaused = true;
    this.pauseDebateBtn.classList.add('paused');
    this.pauseDebateBtn.textContent = '▶';
    this.judgeDebateBtn.disabled = true;

    // Show verdict panel with loading state
    this.verdictPanel.classList.remove('hidden');
    this.verdictContent.innerHTML = '<p style="color: #8b7328; font-style: italic;">⚖️ The judge is deliberating...</p>';

    // Show thinking in sidebar
    this.showThinking('judge', 'Judge');

    try {
      const response = await fetch('/api/judge', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': this.getApiKey()
        },
        body: JSON.stringify({
          debateId: this.debateId,
          advocateArguments: this.advocateArguments,
          skepticArguments: this.skepticArguments
        })
      });

      let fullText = '';
      let thinkingText = '';
      let outputText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.error) {
                throw new Error(data.error);
              }

              if (data.content) {
                fullText += data.content;
                
                const parsed = this.parseResponse(fullText);
                
                // Update thinking sidebar
                if (parsed.thinking !== thinkingText) {
                  thinkingText = parsed.thinking;
                  this.thinkingContent.innerHTML = this.formatText(thinkingText);
                }
                
                // Update verdict content
                if (parsed.output !== outputText) {
                  outputText = parsed.output;
                  this.verdictContent.innerHTML = this.formatVerdict(outputText);
                }
              }

              if (data.done) {
                this.resetThinkingSidebar();
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

    } catch (error) {
      console.error('Judge failed:', error);
      this.verdictContent.innerHTML = `<p style="color: #c4553a;">Failed to get verdict: ${error.message}</p>`;
      this.resetThinkingSidebar();
    }

    this.judgeDebateBtn.disabled = false;
  }

  formatVerdict(text) {
    if (!text) return '';
    
    // Convert markdown-style formatting
    let html = text
      // Headers
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Winner highlighting
      .replace(/Winner: (Advocate)/gi, 'Winner: <span class="verdict-winner advocate">$1</span>')
      .replace(/Winner: (Skeptic)/gi, 'Winner: <span class="verdict-winner skeptic">$1</span>')
      // Line breaks to paragraphs
      .split('\n\n')
      .filter(p => p.trim())
      .map(p => {
        if (p.startsWith('<h2>') || p.startsWith('<h3>')) return p;
        if (p.startsWith('- ') || p.startsWith('* ')) {
          const items = p.split('\n').map(li => `<li>${li.replace(/^[-*] /, '')}</li>`).join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');
    
    return html;
  }

  closeVerdict() {
    this.verdictPanel.classList.add('hidden');
  }

  showThinking(role, name) {
    this.thinkingEmpty.classList.add('hidden');
    this.thinkingActive.classList.remove('hidden');
    this.thinkingWho.textContent = `${name} is reasoning...`;
    this.thinkingWho.className = `thinking-who ${role}`;
    this.thinkingContent.innerHTML = '';
  }

  resetThinkingSidebar() {
    this.thinkingEmpty.classList.remove('hidden');
    this.thinkingActive.classList.add('hidden');
    this.thinkingContent.innerHTML = '';
  }

  parseResponse(text) {
    let thinking = '';
    let output = '';

    // Try to extract <thinking> tags
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)(<\/thinking>|$)/);
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
    }

    // Try to extract <output> tags
    const outputMatch = text.match(/<output>([\s\S]*?)(<\/output>|$)/);
    if (outputMatch) {
      output = outputMatch[1].trim();
    }
    
    // FALLBACK: If no <output> tags found, try to get content after </thinking>
    if (!output && text.includes('</thinking>')) {
      const afterThinking = text.split('</thinking>')[1];
      if (afterThinking) {
        // Remove any remaining tags and clean up
        output = afterThinking
          .replace(/<\/?output>/g, '')
          .replace(/<\/?thinking>/g, '')
          .trim();
      }
    }
    
    // FALLBACK 2: If still no output and no tags at all, just use the text
    if (!output && !text.includes('<thinking>') && !text.includes('<output>')) {
      output = text.trim();
      console.warn('No tags found in response, using raw text');
    }
    
    // FALLBACK 3: If we have thinking but no output, something went wrong - log it
    if (!output && thinking) {
      console.warn('Got thinking but no output. Full text:', text.substring(0, 500));
    }

    return { thinking, output };
  }

  formatText(text) {
    if (!text) return '';
    
    const paragraphs = text.split('\n\n').filter(p => p.trim());
    if (paragraphs.length > 1) {
      return paragraphs.map(p => `<p>${this.escapeHtml(p.trim())}</p>`).join('');
    }
    
    return `<p>${this.escapeHtml(text)}</p>`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  createTypingIndicator(role, name) {
    const el = document.createElement('div');
    el.className = `typing-indicator ${role}`;
    el.innerHTML = `
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="typing-label">${name} is preparing...</span>
    `;
    return el;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.pauseDebateBtn.classList.toggle('paused', this.isPaused);
    
    if (this.isPaused) {
      this.pauseDebateBtn.textContent = '▶';
      this.pauseDebateBtn.title = 'Resume';
    } else {
      this.pauseDebateBtn.textContent = '⏸';
      this.pauseDebateBtn.title = 'Pause';
      
      // Close verdict if open
      this.verdictPanel.classList.add('hidden');
      
      if (!this.isDebating) {
        this.runDebateLoop();
      }
    }
  }

  resetDebate() {
    this.isPaused = true;
    this.debateId = null;
    this.currentRound = 0;
    this.lastAdvocateArgument = '';
    this.lastSkepticArgument = '';
    this.advocateArguments = [];
    this.skepticArguments = [];
    this.ideaInput.value = '';
    
    this.resetThinkingSidebar();
    this.verdictPanel.classList.add('hidden');
    this.debateLayout.classList.add('hidden');
    this.ideaSection.classList.remove('hidden');
    this.ideaInput.focus();
  }

  showError(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%);
      background: #c4553a;
      color: white;
      padding: 0.875rem 1.5rem;
      border-radius: 8px;
      font-weight: 500;
      font-size: 0.875rem;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 5000);
  }

  showMessageError(message) {
    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
      background: #fdf0ed;
      border: 1px solid #c4553a;
      border-radius: 8px;
      padding: 1rem;
      color: #c4553a;
      font-size: 0.875rem;
      margin: 0.5rem 0;
    `;
    errorEl.textContent = message;
    this.debateChat.appendChild(errorEl);
  }

  scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.debateArena = new DebateArena();
});
