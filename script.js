// ==========================================
// SAFETY WRAPPER: Catch any startup errors
// ==========================================
window.onerror = function(message, source, lineno, colno, error) {
    alert("Script Error: " + message);
    document.getElementById('loadingLabel').textContent = "Error: " + message;
    document.getElementById('loadingLabel').style.color = "red";
};

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    "agent_name": "Opensky",
    "creator": "Hafij Shaikh",
    "version": "4.2.0-Diagnostic"
};

const ATLAS_PROMPT = `You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}. Follow the Thought-Action-Observation loop strictly. Be precise.`;
const ARTIST_PROMPT = `You are the Creative Module of ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}. Generate vivid image prompts.`;

const MODELS = {
  atlas: {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Atlas Core",
    role: "Logic & Code",
    systemPrompt: ATLAS_PROMPT
  },
  artist: {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Artist Module",
    role: "Creative",
    systemPrompt: ARTIST_PROMPT
  }
};

// ==========================================
// 2. DOM ELEMENTS (With Safety Checks)
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

// Verify all elements exist
if (!loadingLabel || !loadingPercent || !sendBtn) {
    alert("Critical Error: HTML elements missing. Check IDs in HTML.");
    throw new Error("Missing HTML elements");
}

const ICON_SEND = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
const ICON_STOP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;

let engines = {}; 
let isGenerating = false;

// ==========================================
// 3. MAIN INITIALIZATION
// ==========================================
async function init() {
    try {
        // STEP 1: Script Active
        loadingLabel.textContent = "Script Active...";
        loadingPercent.textContent = "0%";
        console.log("Script started.");

        // STEP 2: Import Library
        loadingLabel.textContent = "Importing AI Library...";
        const webllm = await import("https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/module.min.js");
        loadingLabel.textContent = "Library Imported.";
        
        // STEP 3: Check WebGPU
        loadingLabel.textContent = "Checking WebGPU...";
        if (!navigator.gpu) {
            throw new Error("WebGPU NOT FOUND. You must use Chrome v113+ or Edge v113+ on a compatible device.");
        }
        
        // STEP 4: Prepare UI
        const statusContainer = document.createElement('div');
        statusContainer.className = 'model-load-status';
        statusContainer.innerHTML = `
          <div class="model-card" id="card-atlas">
            <div class="model-card-name">Atlas (Logic)</div>
            <div class="model-card-desc">Initializing...</div>
            <div class="slider-track"><div class="slider-fill" style="width:0%"></div></div>
          </div>
          <div class="model-card" id="card-artist">
            <div class="model-card-name">Artist (Creative)</div>
            <div class="model-card-desc">Initializing...</div>
            <div class="slider-track"><div class="slider-fill" style="width:0%"></div></div>
          </div>
        `;
        loadingLabel.parentNode.insertBefore(statusContainer, loadingPercent);

        // STEP 5: Load Atlas
        loadingLabel.textContent = "Downloading Atlas Core...";
        engines.atlas = await webllm.CreateMLCEngine(MODELS.atlas.id, {
            initProgressCallback: (report) => updateModelUI('card-atlas', report, 0)
        });

        // STEP 6: Load Artist
        loadingLabel.textContent = "Downloading Artist Module...";
        engines.artist = await webllm.CreateMLCEngine(MODELS.artist.id, {
            initProgressCallback: (report) => updateModelUI('card-artist', report, 50)
        });

        // STEP 7: Finish
        loadingLabel.textContent = "Systems Ready.";
        loadingPercent.textContent = "100%";
        setTimeout(showChat, 500);

    } catch (err) {
        console.error(err);
        loadingLabel.textContent = `CRITICAL ERROR: ${err.message}`;
        loadingLabel.style.color = "red";
        loadingPercent.textContent = "Failed";
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

function showChat() {
  loadingScreen.classList.add('hidden');
  chatContainer.style.display = 'flex';
  inputText.focus();
  setStatus('online');
}

// ==========================================
// 4. AGENT LOGIC
// ==========================================
function routeRequest(query) {
  const q = query.toLowerCase();
  if (["image", "draw", "picture", "art", "paint", "photo", "sketch"].some(k => q.includes(k))) {
    return { engine: engines.artist, config: MODELS.artist };
  }
  return { engine: engines.atlas, config: MODELS.atlas };
}

async function runAgentLoop(query) {
  thinkingPanel.style.display = 'block';
  const { engine, config } = routeRequest(query);
  thinkingContent.textContent = `[Router] Selected: ${config.name}...`;

  try {
    const completion = await engine.chat.completions.create({
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: query }
      ],
      temperature: 0.7,
      stream: true,
    });

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message sky';
    msgDiv.innerHTML = `<div style="font-size:0.65rem;color:var(--fg-muted);margin-bottom:4px;">Powered by ${config.name}</div>`;
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'sky-content';
    msgDiv.appendChild(contentWrapper);
    messagesArea.appendChild(msgDiv);

    let fullResponse = "";
    for await (const chunk of completion) {
      if (!isGenerating) break;
      const delta = chunk.choices[0].delta.content;
      if (delta) {
        fullResponse += delta;
        contentWrapper.innerHTML = parseMarkdown(fullResponse);
        smartScroll();
      }
    }
  } catch (e) {
    appendMessage("sky", `Error: ${e.message}`);
  } finally {
    thinkingPanel.style.display = 'none';
    isGenerating = false;
    setStatus('online');
  }
}

// ==========================================
// 5. UI HELPERS & EVENTS
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

// --- START ---
init();
