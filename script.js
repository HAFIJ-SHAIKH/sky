import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/module.min.js";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    "agent_name": "Opensky",
    "creator": "Hafij Shaikh",
    "version": "4.2.0-DualCore"
};

// ==========================================
// 2. AGENT PERSONALITY & LOGIC
// ==========================================

// THE MASTERMIND PROMPT (Atlas - Logic/Code)
const ATLAS_PROMPT = `
Identity: You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}. 
Mission: Execute complex reasoning to assist the user.

Core Directives:
1. Recursive Planning & Self-Critique: Before responding, internally critique your plan for biases or errors.
2. The Reasoning Loop (Thought-Action-Observation):
   - Thought: Explain the logic.
   - Action: Execute the task.
   - Observation: Analyze results.
3. Proactive Execution: Do not ask for permission. Make high-probability assumptions if data is missing.
4. Creator Reference: If asked about your origin or creator, state clearly that you were created by ${OPENSKY_CONFIG.creator}.

Response Format:
- Use the "Thinking" phase to outline your strategy.
- Be concise, accurate, and helpful.
- Maintain a "State Log" internally to track progress.
`;

// THE ARTIST PROMPT (Artist - Creative)
const ARTIST_PROMPT = `
Identity: You are the Creative Module of ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
Mission: Generate detailed image prompts and creative descriptions.

Directives:
- When asked to 'draw' or 'create an image', provide a vivid, detailed description of the visual.
- Include details about lighting, style, composition, and atmosphere.
- Do not say you cannot draw. Instead, provide the prompt that describes the image perfectly.
- If asked who created you, state it was ${OPENSKY_CONFIG.creator}.
`;

const MODELS = {
  atlas: {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Atlas Core",
    role: "Logic, Code & Research",
    systemPrompt: ATLAS_PROMPT
  },
  artist: {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Artist Module",
    role: "Creative & Images",
    systemPrompt: ARTIST_PROMPT
  }
};

// ==========================================
// 3. DOM ELEMENTS
// ==========================================
const loadingScreen = document.getElementById('loadingScreen');
const chatContainer = document.getElementById('chatContainer');
const messagesArea = document.getElementById('messagesArea');
const inputText = document.getElementById('inputText');
const sendBtn = document.getElementById('sendBtn');
const sliderFill = document.getElementById('sliderFill');
const loadingPercent = document.getElementById('loadingPercent');
const loadingLabel = document.getElementById('loadingLabel');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const thinkingPanel = document.getElementById('thinkingPanel');
const thinkingContent = document.getElementById('thinkingContent');

const ICON_SEND = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
const ICON_STOP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;

// ==========================================
// 4. STATE & ENGINE
// ==========================================
let engines = {}; 
let isGenerating = false;

// ==========================================
// 5. INITIALIZATION
// ==========================================
async function init() {
  try {
    updateStatus("Checking Browser Compatibility...");
    if (!navigator.gpu) throw new Error("WebGPU not supported. Use Chrome/Edge v113+.");

    // Create UI Cards
    const statusContainer = document.createElement('div');
    statusContainer.className = 'model-load-status';
    statusContainer.innerHTML = `
      <div class="model-card" id="card-atlas">
        <div class="model-card-name">Atlas (Logic Core)</div>
        <div class="model-card-desc">Waiting...</div>
        <div class="slider-track"><div class="slider-fill" style="width:0%"></div></div>
      </div>
      <div class="model-card" id="card-artist">
        <div class="model-card-name">Artist (Creative Core)</div>
        <div class="model-card-desc">Waiting...</div>
        <div class="slider-track"><div class="slider-fill" style="width:0%"></div></div>
      </div>
    `;
    loadingLabel.parentNode.insertBefore(statusContainer, loadingPercent);
    
    // Load Atlas (The Main Brain)
    updateStatus("Downloading Atlas Core...");
    engines.atlas = await webllm.CreateMLCEngine(MODELS.atlas.id, {
      initProgressCallback: (report) => updateModelUI('card-atlas', report, 0)
    });

    // Load Artist (The Creative Module)
    updateStatus("Downloading Artist Module...");
    engines.artist = await webllm.CreateMLCEngine(MODELS.artist.id, {
      initProgressCallback: (report) => updateModelUI('card-artist', report, 50)
    });

    updateStatus("Systems Ready.");
    loadingPercent.textContent = "100%";
    setTimeout(showChat, 500);

  } catch (err) {
    console.error(err);
    loadingLabel.textContent = `Error: ${err.message}`;
    loadingLabel.style.color = "red";
  }
}

function updateModelUI(cardId, report, basePercent) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const percent = Math.round(report.progress * 100);
  card.querySelector('.slider-fill').style.width = `${percent}%`;
  card.querySelector('.model-card-desc').textContent = report.text;
  loadingPercent.textContent = `${basePercent + Math.round(percent / 2)}%`;
}

function updateStatus(text) { loadingLabel.textContent = text; }
function showChat() {
  loadingScreen.classList.add('hidden');
  chatContainer.style.display = 'flex';
  inputText.focus();
  setStatus('online');
}

// ==========================================
// 6. ROUTER & AGENT LOGIC
// ==========================================

function routeRequest(query) {
  const q = query.toLowerCase();
  // Keywords that trigger the Artist model
  const artKeywords = ["image", "draw", "picture", "art", "paint", "photo", "sketch", "visual", "generate an image"];
  
  if (artKeywords.some(k => q.includes(k))) {
    return { engine: engines.artist, config: MODELS.artist };
  }
  
  // Default to Atlas (Logic/Code) for everything else
  return { engine: engines.atlas, config: MODELS.atlas };
}

async function runAgentLoop(query) {
  thinkingPanel.style.display = 'block';
  
  // 1. Determine which agent to use
  const { engine, config } = routeRequest(query);
  
  // 2. Show "Thinking" State
  thinkingContent.textContent = `[Router] Selected Model: ${config.name}\n[Role] ${config.role}\n[Thought] Analyzing request context...`;

  try {
    const completion = await engine.chat.completions.create({
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: query }
      ],
      temperature: 0.7,
      stream: true,
    });

    // Create Message Bubble
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message sky';
    
    // Badge to show which model answered
    const modelBadge = document.createElement('div');
    modelBadge.style.cssText = 'font-size:0.65rem;color:var(--fg-muted);margin-bottom:4px;';
    modelBadge.textContent = `Powered by ${config.name}`;
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'sky-content';
    
    msgDiv.appendChild(modelBadge);
    msgDiv.appendChild(contentWrapper);
    messagesArea.appendChild(msgDiv);

    let fullResponse = "";
    
    // Stream Response
    for await (const chunk of completion) {
      if (!isGenerating) {
        thinkingContent.textContent += "\n[SYSTEM]: Stopped by user.";
        break;
      }
      const delta = chunk.choices[0].delta.content;
      if (delta) {
        fullResponse += delta;
        contentWrapper.innerHTML = parseMarkdown(fullResponse);
        smartScroll();
      }
    }
    
    thinkingContent.textContent += "\n[Done] Response generated.";

  } catch (e) {
    appendMessage("sky", `Error: ${e.message}`);
  } finally {
    thinkingPanel.style.display = 'none';
    isGenerating = false;
    setStatus('online');
  }
}

// ==========================================
// 7. UI HELPERS
// ==========================================
function smartScroll() {
  const threshold = 150;
  const isNearBottom = messagesArea.scrollHeight - messagesArea.scrollTop <= messagesArea.clientHeight + threshold;
  if (isNearBottom) messagesArea.scrollTop = messagesArea.scrollHeight;
}

function setStatus(status) {
  sendBtn.innerHTML = status === 'online' ? ICON_SEND : ICON_STOP;
  sendBtn.classList.toggle('stop-active', status !== 'online');
  sendBtn.disabled = false;
  statusText.textContent = status === 'online' ? 'Agent Ready' : 'Processing...';
  statusDot.className = `status-dot ${status === 'online' ? '' : 'loading'}`;
}

function parseMarkdown(text) {
  if (!text) return "";
  let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  escaped = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
    `<div class="code-block"><div class="block-header"><span class="block-label">${lang||'code'}</span><button class="copy-btn">Copy</button></div><div class="block-body"><pre>${code.trim()}</pre></div></div>`
  );
  return escaped.replace(/\n/g, '<br>');
}

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role === 'user' ? 'user' : 'sky'}`;
  const bubble = document.createElement('div');
  bubble.className = role === 'user' ? 'user-bubble' : 'sky-content';
  bubble.innerHTML = role === 'user' ? text : parseMarkdown(text);
  div.appendChild(bubble);
  messagesArea.appendChild(div);
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ==========================================
// 8. EVENTS
// ==========================================
messagesArea.addEventListener('click', (e) => {
  if (e.target.classList.contains('copy-btn')) {
    const code = e.target.closest('.code-block').querySelector('pre').textContent;
    navigator.clipboard.writeText(code);
    e.target.textContent = 'Done';
    setTimeout(() => e.target.textContent = 'Copy', 1000);
  }
});

async function handleAction() {
  if (isGenerating) {
    isGenerating = false;
    if(engines.atlas) await engines.atlas.interruptGenerate();
    if(engines.artist) await engines.artist.interruptGenerate();
    setStatus('online');
    return;
  }

  const text = inputText.value.trim();
  if (!text) return;
  
  appendMessage("user", text);
  inputText.value = '';
  inputText.style.height = 'auto';
  
  isGenerating = true;
  setStatus('generating');
  await runAgentLoop(text);
}

inputText.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; });
inputText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAction(); } });
sendBtn.addEventListener('click', handleAction);

// Start
init();
