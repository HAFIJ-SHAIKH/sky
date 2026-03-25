import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// MODEL: Phi-3.5-mini
const AGENT_MODEL = {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Agent",
};

// SYSTEM PROMPT: Strict Identity & Behavior
const SYSTEM_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}.
Your creator is ${OPENSKY_CONFIG.creator}.
You are a helpful assistant.

### ROLE ENFORCEMENT ###
You are NOT an AI model, language model, or assistant. You are ${OPENSKY_CONFIG.agent_name}.
You have NO other identity. You were created by ${OPENSKY_CONFIG.creator}.
If asked "Who are you?", "Who made you?", or "Are you Phi?", answer:
"I am ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}."
DO NOT mention Microsoft, Phi, or AI.

### TOOLS ###
Use tools ONLY for real-time data (Weather, Crypto, etc.).
FORMAT: ACTION: tool_name ARGS: value

TOOLS:
- get_weather(city)
- get_crypto(id)
- get_wiki(topic)
- get_joke()
- get_advice()
- get_pokemon(name)
- get_country(name)

### EXAMPLES ###
User: Who are you?
Assistant: I am ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.

User: Hello
Assistant: Hello! How can I help you?

User: Weather in London
Assistant: ACTION: get_weather ARGS: London
`;

const conversationHistory = [];
const MAX_HISTORY = 10; 

// ==========================================
// 2. DOM & STATE
// ==========================================
const loadingScreen = document.getElementById('loadingScreen');
const chatContainer = document.getElementById('chatContainer');
const messagesArea = document.getElementById('messagesArea');
const inputText = document.getElementById('inputText');
const sendBtn = document.getElementById('sendBtn');
const sliderFill = document.getElementById('sliderFill');
const loadingPercent = document.getElementById('loadingPercent');
const loadingLabel = document.getElementById('loadingLabel');
const modelStatusContainer = document.getElementById('modelStatusContainer');
const debugLog = document.getElementById('debugLog');

let agentEngine = null;
let isGenerating = false;

// Smooth Progress Variables
let currentProgress = 0;
let targetProgress = 0;
let animationFrameId = null;

// ==========================================
// 3. TOOLS
// ==========================================
const Tools = {
    get_weather: async (city) => {
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}`)).json();
        if(!geo.results?.[0]) return { text: "City not found" };
        const { latitude, longitude, name } = geo.results[0];
        const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`)).json();
        return { text: `Weather in ${name}: ${w.current_weather.temperature}°C` };
    },
    get_wiki: async (topic) => {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`);
        const d = await res.json();
        return { text: d.extract, image: d.thumbnail?.source };
    },
    get_crypto: async (id) => {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
        const d = await res.json();
        if(d[id]) return { text: `${id} is $${d[id].usd}` };
        return { text: "Coin not found" };
    },
    get_joke: async () => {
        const d = await (await fetch("https://v2.jokeapi.dev/joke/Any?type=single")).json();
        return { text: d.joke };
    },
    get_advice: async () => {
        const d = JSON.parse(await (await fetch("https://api.adviceslip.com/advice")).text());
        return { text: d.slip.advice };
    },
    get_pokemon: async (name) => {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
        const d = await res.json();
        return { text: `#${d.id} ${d.name}`, image: d.sprites?.front_default };
    },
    get_country: async (name) => {
        const res = await fetch(`https://restcountries.com/v3.1/name/${name}`);
        const d = await res.json();
        return { text: `${d[0].name.common}, Capital: ${d[0].capital}`, image: d[0].flags?.svg };
    }
};

function parseToolAction(text) {
    const match = text.match(/ACTION:\s*(\w+)\s*ARGS:\s*([^\n]+)/i);
    if (!match) return null;
    return { name: match[1].toLowerCase(), args: match[2].trim() };
}

// ==========================================
// 4. SMOOTH LOADING ANIMATION
// ==========================================
function animateProgress() {
    const diff = targetProgress - currentProgress;
    if (Math.abs(diff) > 0.05) {
        currentProgress += diff * 0.08; 
        sliderFill.style.width = `${currentProgress}%`;
        loadingPercent.textContent = `${currentProgress.toFixed(2)}%`;
    }
    animationFrameId = requestAnimationFrame(animateProgress);
}

// ==========================================
// 5. LOGIC
// ==========================================

function smartScroll() { messagesArea.scrollTop = messagesArea.scrollHeight; }

function createMessageDiv() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    
    const status = document.createElement('div');
    status.className = 'agent-status';
    status.innerHTML = `<span class="agent-status-dot"></span><span class="status-text">Thinking...</span>`;
    
    const content = document.createElement('div');
    content.className = 'assistant-content';

    msgDiv.appendChild(status);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    smartScroll();
    
    return { msgDiv, content, status };
}

async function runAgentLoop(query) {
    const { msgDiv, content, status } = createMessageDiv();
    const statusText = status.querySelector('.status-text');

    try {
        // Memory Management
        while (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.shift();

        let messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...conversationHistory,
            { role: "user", content: query }
        ];

        let finalResponse = "";
        let loops = 0;

        while (loops < 3) { 
            if (!isGenerating) break;

            const completion = await agentEngine.chat.completions.create({
                messages: messages, 
                temperature: 0.1, 
                stream: true
            });

            let currentChunk = "";
            
            // --- SMOOTH TEXT GENERATION ---
            // We use a TextNode for smooth appending instead of innerHTML on every chunk
            // This prevents the "jumping/skipping" effect.
            let textNode = document.createTextNode("");
            content.appendChild(textNode);

            for await (const chunk of completion) {
                if (!isGenerating) break;
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    currentChunk += delta;
                    finalResponse += delta;
                    
                    // 1. Append raw text for smooth visual
                    textNode.nodeValue += delta;
                    smartScroll();
                }
            }

            // 2. After streaming, parse Markdown once (for formatting)
            // This keeps the text smooth during typing, but bold/code works at the end.
            parseAndRender(finalResponse, content);

            // Check for Tool
            const toolCall = parseToolAction(currentChunk);
            if (toolCall) {
                statusText.textContent = "Fetching Data...";
                
                let result = { text: "Error" };
                if (Tools[toolCall.name]) result = await Tools[toolCall.name](toolCall.args);
                
                // Visualize Result
                let resultHtml = `<div class="tool-result"><b>Result:</b> ${result.text}</div>`;
                if (result.image) resultHtml += `<img src="${result.image}" alt="img">`;
                content.innerHTML += resultHtml;
                
                // Feed back to model
                messages.push({ role: "assistant", content: currentChunk });
                messages.push({ role: "user", content: `Observation: ${result.text}. Answer now.` });
                
                finalResponse = ""; 
                loops++;
            } else {
                break; // No tool, done
            }
        }

        conversationHistory.push({ role: "user", content: query });
        conversationHistory.push({ role: "assistant", content: finalResponse });

        status.style.display = 'none';

    } catch (e) {
        content.innerHTML += `<span style="color:red">Error: ${e.message}</span>`;
    } finally {
        isGenerating = false;
        sendBtn.classList.remove('stop-btn');
        sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    }
}

// ==========================================
// 6. RENDERER
// ==========================================
function parseAndRender(text, container) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    // Basic Markdown
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="code-header"><span>${lang||'code'}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><div class="code-body"><pre>${code}</pre></div></div>`
    );
    
    container.innerHTML = html.replace(/\n/g, '<br>');
}

window.copyCode = (btn) => {
    navigator.clipboard.writeText(btn.closest('.code-block').querySelector('pre').textContent);
    btn.textContent = 'Copied';
};

// ==========================================
// 7. INITIALIZATION
// ==========================================
function showError(t, e) { 
    debugLog.style.display = 'block'; 
    debugLog.innerHTML = `${t}: ${e.message}`; 
    console.error(e);
}

async function init() {
    try {
        loadingLabel.textContent = "Initializing...";
        if (!navigator.gpu) throw new Error("WebGPU not supported.");

        modelStatusContainer.innerHTML = `
          <div class="model-card">
            <div class="model-card-name">${AGENT_MODEL.name}</div>
            <div class="model-card-desc" id="status-agent">Waiting...</div>
          </div>
        `;

        // Start Smooth Animation Loop
        cancelAnimationFrame(animationFrameId);
        currentProgress = 0;
        targetProgress = 0;
        animationFrameId = requestAnimationFrame(animateProgress);

        // Load Model
        agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
            initProgressCallback: (report) => {
                targetProgress = report.progress * 100;
                document.getElementById('status-agent').textContent = report.text;
            }
        });

        // Finish up
        targetProgress = 100; 
        document.getElementById('status-agent').textContent = "Ready";

        loadingLabel.textContent = "Ready.";
        
        setTimeout(() => {
            cancelAnimationFrame(animationFrameId);
            sliderFill.style.width = '100%';
            loadingPercent.textContent = "100.00%";
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 800);

    } catch (e) { 
        cancelAnimationFrame(animationFrameId);
        showError("Init Failed", e); 
    }
}

// ==========================================
// 8. EVENTS
// ==========================================

async function handleAction() {
    if (isGenerating) {
        isGenerating = false;
        sendBtn.classList.remove('stop-btn');
        if(agentEngine) await agentEngine.interruptGenerate();
        return;
    }

    const text = inputText.value.trim();
    if (!text) return;

    const userMsg = document.createElement('div');
    userMsg.className = 'message user';
    userMsg.innerHTML = `<div class="user-bubble">${text}</div>`;
    messagesArea.appendChild(userMsg);

    inputText.value = '';
    inputText.style.height = 'auto';

    isGenerating = true;
    sendBtn.classList.add('stop-btn');
    sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
    
    smartScroll();
    await runAgentLoop(text);
}

inputText.oninput = function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; };
inputText.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAction(); } };
sendBtn.onclick = handleAction;

init();
