import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// AGENT: Qwen2.5-1.5B (Fast, Smart enough for draft)
const AGENT_MODEL = {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Agent",
};

// CORE: Phi-3.5-Mini (3.8B - The ~4B Model you requested)
const CORE_MODEL = {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Core",
};

const AGENT_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
You are a fast drafting assistant. Write a quick response.
If you need tools: ACTION: tool_name ARGS: value
Tools: wiki(topic), weather(city), pokemon(name), country(name), define(word), joke(), advice(), bored().
`;

const CORE_SYSTEM_PROMPT = `
You are the Core Intelligence of ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
You verify the Agent's draft. 
If the draft is good, output [OK].
If the draft is wrong or can be improved, output the corrected answer.
`;

const conversationHistory = [];
const MAX_HISTORY = 40; 

// ==========================================
// 2. DOM
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
let coreEngine = null;
let isGenerating = false;

// Smooth Progress Variables
let currentProgress = 0;
let targetProgress = 0;
let progressInterval;

function updateProgressSmoothly() {
    if (Math.abs(currentProgress - targetProgress) > 0.1) {
        currentProgress += (targetProgress - currentProgress) * 0.1; 
        sliderFill.style.width = `${currentProgress}%`;
        loadingPercent.textContent = `${currentProgress.toFixed(2)}%`;
    }
}

// ==========================================
// 3. TOOLS
// ==========================================
const Tools = {
    wiki: async (q) => {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
        const d = await res.json();
        return { text: d.extract, image: d.thumbnail?.source };
    },
    weather: async (city) => {
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}`)).json();
        if(!geo.results?.[0]) return { text: "City not found" };
        const { latitude, longitude, name } = geo.results[0];
        const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`)).json();
        return { text: `Weather in ${name}: ${w.current_weather.temperature}°C` };
    },
    define: async (word) => {
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
            const d = await res.json();
            return { text: d[0].meanings[0].definitions[0].definition };
        } catch { return { text: "Not found" }; }
    },
    pokemon: async (name) => {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
        const d = await res.json();
        return { text: `#${d.id} ${d.name}`, image: d.sprites?.front_default };
    },
    country: async (name) => {
        const res = await fetch(`https://restcountries.com/v3.1/name/${name}`);
        const d = await res.json();
        return { text: `${d[0].name.common}, Capital: ${d[0].capital}`, image: d[0].flags?.svg };
    },
    joke: async () => {
        const d = await (await fetch(`https://esm.run/@mlc-ai/web-llm";
import { StateGraph, END } from "https://esm.run/@langchain/langgraph";
import { HumanMessage, AIMessage } from "https://esm.run/@langchain/core/messages";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// AGENT: Qwen2.5-1.5B (Fast, Smart enough for draft)
const AGENT_MODEL = {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Agent",
};

// CORE: Phi-3.5-Mini (3.8B - The ~4B Model you requested)
// Uses ~2.8GB VRAM. Total usage with Agent is under 5GB.
const CORE_MODEL = {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Core",
};

// PROMPTS
const AGENT_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
You are a fast drafting assistant. Write a quick response.
If you need tools: ACTION: tool_name ARGS: value
Tools: wiki(topic), weather(city), pokemon(name), country(name), define(word), joke(), advice(), bored().
`;

const CORE_SYSTEM_PROMPT = `
You are the Core Intelligence of ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
You verify the Agent's draft. 
If the draft is good, output [OK].
If the draft is wrong or can be improved, output the corrected answer.
`;

const conversationHistory = [];
const MAX_HISTORY = 40; 

// ==========================================
// 2. DOM
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
let coreEngine = null;
let isGenerating = false;

// Smooth Progress Variables
let currentProgress = 0;
let targetProgress = 0;
let progressInterval;

function updateProgressSmoothly() {
    if (Math.abs(currentProgress - targetProgress) > 0.1) {
        // Ease out animation
        currentProgress += (targetProgress - currentProgress) * 0.1; 
        sliderFill.style.width = `${currentProgress}%`;
        loadingPercent.textContent = `${currentProgress.toFixed(2)}%`;
    }
}

// ==========================================
// 3. TOOLS
// ==========================================
const Tools = {
    wiki: async (q) => {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
        const d = await res.json();
        return { text: d.extract, image: d.thumbnail?.source };
    },
    weather: async (city) => {
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}`)).json();
        if(!geo.results?.[0]) return { text: "City not found" };
        const { latitude, longitude, name } = geo.results[0];
        const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`)).json();
        return { text: `Weather in ${name}: ${w.current_weather.temperature}°C` };
    },
    define: async (word) => {
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
            const d = await res.json();
            return { text: d[0].meanings[0].definitions[0].definition };
        } catch { return { text: "Not found" }; }
    },
    pokemon: async (name) => {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
        const d = await res.json();
        return { text: `#${d.id} ${d.name}`, image: d.sprites?.front_default };
    },
    country: async (name) => {
        const res = await fetch(`https://restcountries.com/v3.1/name/${name}`);
        const d = await res.json();
        return { text: `${d[0].name.common}, Capital: ${d[0].capital}`, image: d[0].flags?.svg };
    },
    joke: async () => {
        const d = await (await fetch("https://v2.jokeapi.dev/joke/Any?type=single")).json();
        return { text: d.joke };
    },
    advice: async () => {
        const d = JSON.parse(await (await fetch("https://api.adviceslip.com/advice")).text());
        return { text: d.slip.advice };
    },
    bored: async () => {
        const d = await (await fetch("https://www.boredapi.com/api/activity")).json();
        return { text: d.activity };
    }
};

function parseToolAction(text) {
    const match = text.match(/ACTION:\s*(\w+)\s*ARGS:\s*([^\n]+)/i);
    if (!match) return null;
    return { name: match[1].toLowerCase(), args: match[2].trim() };
}

// ==========================================
// 4. LOGIC
// ==========================================

function smartScroll() { messagesArea.scrollTop = messagesArea.scrollHeight; }

function createMessageDiv() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    
    const status = document.createElement('div');
    status.className = 'agent-status';
    // Added the dot class
    status.innerHTML = `<span class="agent-status-dot"></span><span class="status-text">Drafting...</span>`;
    
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
        // --- 1. AGENT PROCESS (Drafting) ---
        let agentMessages = [
            { role: "system", content: AGENT_PROMPT },
            ...conversationHistory,
            { role: "user", content: query }
        ];

        let agentText = "";
        let loops = 0;
        let toolUsed = false;

        while (loops < 3) {
            const completion = await agentEngine.chat.completions.create({
                messages: agentMessages, temperature: 0.7, stream: true
            });

            let currentChunk = "";
            for await (const chunk of completion) {
                if (!isGenerating) break;
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    currentChunk += delta;
                    agentText += delta;
                    parseAndRender(agentText, content);
                    smartScroll();
                }
            }

            const toolCall = parseToolAction(currentChunk);
            if (toolCall) {
                toolUsed = true;
                statusText.textContent = "Fetching Tool...";
                let result = { text: "Error" };
                if (Tools[toolCall.name]) result = await Tools[toolCall.name](toolCall.args);
                
                let resultHtml = `<div class="tool-result"><b>Result:</b> ${result.text}</div>`;
                if (result.image) resultHtml += `<img src="${result.image}">`;
                content.innerHTML += resultHtml;
                
                agentMessages.push({ role: "assistant", content: currentChunk });
                agentMessages.push({ role: "user", content: `OBSERVATION: ${JSON.stringify(result.text)}. Now answer.` });
                agentText = ""; 
                loops++;
            } else {
                break; 
            }
        }

        // --- 2. CORE PROCESS (Refining) ---
        // We only run Core if no tools were used (Tools are usually accurate)
        if (!toolUsed) {
            statusText.textContent = "Refining...";
            
            // FIX: Construct proper User message for Core
            // We don't pass the whole history to Core to save tokens/time, just the current context.
            // This prevents the "Last message should be user" error.
            const coreMessages = [
                { role: "system", content: CORE_SYSTEM_PROMPT },
                { role: "user", content: `User Query: ${query}\n\nAgent Draft: ${agentText}\n\nReview this draft. Output [OK] if good, or the corrected answer.` }
            ];

            const coreCompletion = await coreEngine.chat.completions.create({
                messages: coreMessages, temperature: 0.3, max_tokens: 1000
            });

            const coreText = coreCompletion.choices[0].message.content.trim();

            if (coreText !== "[OK]") {
                // CORE CORRECTED IT
                parseAndRender(coreText, content);
                content.innerHTML += `<div class="corrected-badge">✨ Refined by Core</div>`;
                agentText = coreText; // Save corrected text to history
            } else {
                // CORE APPROVED
                content.innerHTML += `<div class="verified-badge">✓ Verified</div>`;
            }
        }

        conversationHistory.push({ role: "user", content: query });
        conversationHistory.push({ role: "assistant", content: agentText });

        status.style.display = 'none';

    } catch (e) {
        content.innerHTML += `<span style="color:red; display:block; margin-top:5px;">Error: ${e.message}</span>`;
        console.error(e);
    } finally {
        isGenerating = false;
        sendBtn.classList.remove('stop-btn');
        sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    }
}

// ==========================================
// 5. RENDERER
// ==========================================
function parseAndRender(text, container) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/g, '');
    
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
// 6. INITIALIZATION
// ==========================================
function showError(t, e) { 
    debugLog.style.display = 'block'; 
    debugLog.innerHTML = `${t}: ${e.message}`; 
    console.error(e);
}

async function init() {
    try {
        loadingLabel.textContent = "Checking WebGPU...";
        if (!navigator.gpu) throw new Error("WebGPU not supported.");

        modelStatusContainer.innerHTML = `
          <div class="model-card">
            <div class="model-card-name">${AGENT_MODEL.name}</div>
            <div class="model-card-desc" id="status-agent">Waiting...</div>
          </div>
          <div class="model-card">
            <div class="model-card-name">${CORE_MODEL.name}</div>
            <div class="model-card-desc" id="status-core">Queued...</div>
          </div>
        `;

        // Start smooth updater
        clearInterval(progressInterval);
        progressInterval = setInterval(updateProgressSmoothly, 30);

        // 1. Download Agent (0% -> 50%)
        loadingLabel.textContent = `Loading Agent...`;
        agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
            initProgressCallback: (report) => {
                targetProgress = report.progress * 50; 
                document.getElementById('status-agent').textContent = report.text;
            }
        });
        document.getElementById('status-agent').textContent = "Ready";
        currentProgress = 50; targetProgress = 50; // Snap to 50

        // 2. Download Core (50% -> 100%)
        loadingLabel.textContent = `Loading Core...`;
        coreEngine = await webllm.CreateMLCEngine(CORE_MODEL.id, {
            initProgressCallback: (report) => {
                targetProgress = 50 + (report.progress * 50); 
                document.getElementById('status-core').textContent = report.text;
            }
        });
        document.getElementById('status-core').textContent = "Ready";
        
        // Finish animation
        targetProgress = 100;
        setTimeout(() => {
            clearInterval(progressInterval);
            sliderFill.style.width = `100%`;
            loadingPercent.textContent = `100.00%`;
        }, 500);

        loadingLabel.textContent = "System Online.";
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 800);

    } catch (e) { 
        clearInterval(progressInterval);
        showError("Init Failed", e); 
    }
}

// ==========================================
// 7. EVENTS
// ==========================================

async function handleAction() {
    if (isGenerating) {
        isGenerating = false;
        sendBtn.classList.remove('stop-btn');
        if(agentEngine) await agentEngine.interruptGenerate();
        if(coreEngine) await coreEngine.interruptGenerate();
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
