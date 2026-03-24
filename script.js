import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { StateGraph, END } from "https://esm.run/@langchain/langgraph";
import { HumanMessage, AIMessage } from "https://esm.run/@langchain/core/messages";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// ROUTER: Fast, handles tools and simple chat
const ROUTER_CONFIG = {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC", 
    name: "Phi-3.5 Mini",
    role: "Router"
};

// WORKER: Heavy, handles complex reasoning
const WORKER_CONFIG = {
    id: "Llama-3-8B-Instruct-q4f16_1-MLC",
    name: "Llama-3 8B",
    role: "Worker"
};

const ROUTER_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, a fast router.
1. For complex tasks (coding, advanced math, reasoning): Output exactly [ROUTE_TO_WORKER].
2. For everything else: Respond conversationally.
3. To use tools: ACTION: tool_name ARGS: value
Tools: wiki(topic), weather(city), define(word), country(name), pokemon(name), joke(), advice(), bored(), ocr(image).
`;

const WORKER_PROMPT = `
You are the Advanced Intelligence Core of ${OPENSKY_CONFIG.agent_name}.
You are brilliant at coding, math, and creative writing. Be detailed and helpful.
`;

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
const uploadBtn = document.getElementById('uploadBtn');
const imageInput = document.getElementById('imageInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');

let routerEngine = null;
let workerEngine = null;
let isGenerating = false;
let currentImageBase64 = null; 

// ==========================================
// 3. TOOLS (Restored All)
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
        } catch { return { text: "Definition not found" }; }
    },
    country: async (name) => {
        const res = await fetch(`https://restcountries.com/v3.1/name/${name}`);
        const d = await res.json();
        return { text: `${d[0].name.common}, Capital: ${d[0].capital}`, image: d[0].flags?.svg };
    },
    pokemon: async (name) => {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
        const d = await res.json();
        return { text: `#${d.id} ${d.name.toUpperCase()}`, image: d.sprites?.front_default };
    },
    joke: async () => {
        const d = await (await fetch("https://v2.jokeapi.dev/joke/Any?type=single")).json();
        return { text: d.joke };
    },
    advice: async () => {
        const d = await (await fetch("https://api.adviceslip.com/advice")).text();
        return { text: JSON.parse(d).slip.advice };
    },
    bored: async () => {
        const d = await (await fetch("https://www.boredapi.com/api/activity")).json();
        return { text: `${d.activity} (${d.type})` };
    },
    ocr: async (base64) => {
        try {
            const result = await Tesseract.recognize(`data:image/jpeg;base64,${base64}`, 'eng');
            return { text: result.data.text || "No text found." };
        } catch(e) { return { text: "OCR failed" }; }
    }
};

function parseToolAction(text) {
    const match = text.match(/ACTION:\s*(\w+)\s*ARGS:\s*([^\n]+)/i);
    if (!match) return null;
    return { name: match[1].toLowerCase(), args: match[2].trim() };
}

// ==========================================
// 4. LANGGRAPH DEFINITION
// ==========================================

const agentState = {
    messages: { value: (x, y) => x.concat(y), default: () => [] },
    imageData: { value: (x, y) => y ?? x, default: () => null },
    nextAction: { value: (x, y) => y, default: () => null }
};

// NODE: Router (Fast)
async function routerNode(state) {
    const history = state.messages;
    const messages = [
        { role: "system", content: ROUTER_PROMPT },
        ...history.map(m => ({ role: m._getType(), content: m.content }))
    ];

    const msgDiv = createMessageUI("⚡ Router (Phi-3.5)");
    const content = msgDiv.querySelector('.assistant-content');
    const body = msgDiv.querySelector('.agent-body');

    const stream = await routerEngine.chat.completions.create({
        messages, temperature: 0.1, stream: true
    });

    let fullText = "";
    for await (const chunk of stream) {
        if (!isGenerating) break;
        const delta = chunk.choices[0].delta.content;
        if (delta) {
            fullText += delta;
            body.textContent = fullText;
            parseAndRender(fullText, content);
            smartScroll();
        }
    }
    
    // Decision Logic
    if (fullText.includes("[ROUTE_TO_WORKER]")) {
        updateStatus(msgDiv, "⏳ Routing to Worker...");
        return { nextAction: "worker", messages: [new AIMessage(fullText)] };
    }
    
    const toolCall = parseToolAction(fullText);
    if (toolCall) return { nextAction: "tools", messages: [new AIMessage(fullText)] };

    return { nextAction: END, messages: [new AIMessage(fullText)] };
}

// NODE: Worker (Heavy)
async function workerNode(state) {
    const history = state.messages;
    // Filter out the [ROUTE_TO_WORKER] text for clean context
    const cleanHistory = history.map(m => {
        if (m.content.includes("[ROUTE_TO_WORKER]")) {
            return new HumanMessage("Please handle this complex request.");
        }
        return m;
    });

    const messages = [
        { role: "system", content: WORKER_PROMPT },
        ...cleanHistory.map(m => ({ role: m._getType(), content: m.content }))
    ];

    const msgDiv = createMessageUI("🧠 Worker (Llama-3 8B)");
    const content = msgDiv.querySelector('.assistant-content');
    const body = msgDiv.querySelector('.agent-body');

    const stream = await workerEngine.chat.completions.create({
        messages, temperature: 0.7, stream: true
    });

    let fullText = "";
    for await (const chunk of stream) {
        if (!isGenerating) break;
        const delta = chunk.choices[0].delta.content;
        if (delta) {
            fullText += delta;
            body.textContent = fullText;
            parseAndRender(fullText, content);
            smartScroll();
        }
    }
    return { nextAction: END, messages: [new AIMessage(fullText)] };
}

// NODE: Tools
async function toolNode(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    const text = lastMessage.content;
    const toolCall = parseToolAction(text);
    
    if (!toolCall) return { nextAction: END };

    let result;
    if (toolCall.name === 'ocr' && state.imageData) {
        result = await Tools.ocr(state.imageData);
    } else if (Tools[toolCall.name]) {
        result = await Tools[toolCall.name](toolCall.args);
    } else {
        result = { text: "Unknown tool" };
    }

    appendToolResult(result);
    return { 
        messages: [new HumanMessage(`OBSERVATION: ${result.text}. Now answer.`)],
        nextAction: "router" 
    };
}

function checkNextAction(state) {
    return state.nextAction || END;
}

// Build Graph
let app;
async function initGraph() {
    const workflow = new StateGraph({ channels: agentState });
    
    workflow.addNode("router", routerNode);
    workflow.addNode("worker", workerNode);
    workflow.addNode("tools", toolNode);
    
    workflow.setEntryPoint("router");
    
    workflow.addConditionalEdges("router", checkNextAction);
    workflow.addConditionalEdges("worker", checkNextAction);
    workflow.addEdge("tools", "router");
    
    app = workflow.compile();
}

// ==========================================
// 5. INIT (Downloads Both Models)
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

        // Prepare UI Cards
        modelStatusContainer.innerHTML = `
          <div class="model-card">
            <div class="model-card-name">${ROUTER_CONFIG.name}</div>
            <div class="model-card-desc" id="router-status">Waiting...</div>
          </div>
          <div class="model-card">
             <div class="model-card-name">${WORKER_CONFIG.name}</div>
             <div class="model-card-desc" id="worker-status">Queued...</div>
          </div>
        `;

        // 1. Download Router
        loadingLabel.textContent = `Downloading Router (${ROUTER_CONFIG.name})...`;
        routerEngine = await webllm.CreateMLCEngine(ROUTER_CONFIG.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                sliderFill.style.width = `${p}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('router-status').textContent = report.text;
            }
        });
        document.getElementById('router-status').textContent = "Ready";

        // 2. Download Worker Immediately
        loadingLabel.textContent = `Downloading Worker (${WORKER_CONFIG.name})...`;
        sliderFill.style.width = "0%"; // Reset bar
        loadingPercent.textContent = "0%";
        
        workerEngine = await webllm.CreateMLCEngine(WORKER_CONFIG.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                sliderFill.style.width = `${p}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('worker-status').textContent = report.text;
            }
        });
        document.getElementById('worker-status').textContent = "Ready";

        // 3. Compile Graph
        loadingLabel.textContent = "Compiling Agent Graph...";
        await initGraph();

        loadingLabel.textContent = "System Online.";
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 500);

    } catch (e) { 
        showError("Initialization Failed", e); 
    }
}

// ==========================================
// 6. UI HELPERS & EVENTS
// ==========================================
function createMessageUI(statusText) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    const panel = document.createElement('div');
    panel.className = 'agent-panel open';
    panel.innerHTML = `<div class="agent-header"><span>${statusText}</span></div><div class="agent-body"></div>`;
    panel.querySelector('.agent-header').onclick = () => panel.classList.toggle('open');
    const content = document.createElement('div');
    content.className = 'assistant-content';
    msgDiv.appendChild(panel);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    return msgDiv;
}

function appendToolResult(result) {
    const lastContent = messagesArea.querySelector('.message:last-child .assistant-content');
    if(lastContent) {
        let html = `<div class="tool-result"><b>Tool Result:</b> ${result.text}</div>`;
        if(result.image) html += `<img src="${result.image}" style="max-width:100px; border-radius:4px; margin-top:5px;">`;
        lastContent.innerHTML += html;
    }
}

function updateStatus(msgDiv, text) {
    const span = msgDiv.querySelector('.agent-header span');
    if(span) span.textContent = text;
}

function smartScroll() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function parseAndRender(text, container) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/```chart\s*([\s\S]*?)```/g, (match, json) => {
        try {
            const data = JSON.parse(json);
            const id = 'chart_' + Math.random().toString(36).substr(2, 9);
            setTimeout(() => {
                const el = document.getElementById(id);
                if(el) new Chart(el, { type: data.type || 'bar', data: data.data, options: { responsive: true, maintainAspectRatio: false } });
            }, 50);
            return `<div class="chart-container"><canvas id="${id}"></canvas></div>`;
        } catch(e) { return `<div style="color:red">Chart Error</div>`; }
    });
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="code-header"><span>${lang||'code'}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><div class="code-body"><pre>${code}</pre></div></div>`
    );
    container.innerHTML = html.replace(/\n/g, '<br>');
}

window.copyCode = (btn) => {
    navigator.clipboard.writeText(btn.closest('.code-block').querySelector('pre').textContent);
    btn.textContent = 'Copied';
    setTimeout(()=>btn.textContent='Copy', 1000);
};

uploadBtn.onclick = () => imageInput.click();
imageInput.onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        currentImageBase64 = ev.target.result.split(',')[1];
        imagePreview.src = ev.target.result;
        imagePreviewContainer.classList.add('active');
    };
    reader.readAsDataURL(file);
};
removeImageBtn.onclick = () => { currentImageBase64 = null; imagePreviewContainer.classList.remove('active'); imageInput.value = ''; };

async function handleAction() {
    if (isGenerating) {
        isGenerating = false;
        sendBtn.classList.remove('stop-btn');
        if(routerEngine) await routerEngine.interruptGenerate();
        if(workerEngine) await workerEngine.interruptGenerate();
        return;
    }

    const text = inputText.value.trim();
    const hasImage = !!currentImageBase64;
    if (!text && !hasImage) return;

    const userMsg = document.createElement('div');
    userMsg.className = 'message user';
    userMsg.innerHTML = `<div class="user-bubble">${text}${hasImage ? `<img src="data:image/jpeg;base64,${currentImageBase64}">` : ''}</div>`;
    messagesArea.appendChild(userMsg);

    const userInput = text || "Read this image.";
    const inputWithHint = hasImage ? `[Image Uploaded] ${userInput}. Use ACTION: ocr ARGS: image.` : userInput;

    inputText.value = '';
    inputText.style.height = 'auto';
    
    const imageForGraph = currentImageBase64;
    currentImageBase64 = null;
    imagePreviewContainer.classList.remove('active');
    imageInput.value = '';

    isGenerating = true;
    sendBtn.classList.add('stop-btn');
    sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
    smartScroll();

    try {
        const stream = await app.stream({ messages: [new HumanMessage(inputWithHint)], imageData: imageForGraph });
        for await (const event of stream) {
            if (!isGenerating) break;
        }
    } catch (e) {
        console.error(e);
    } finally {
        isGenerating = false;
        sendBtn.classList.remove('stop-btn');
        sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    }
}

inputText.oninput = function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; };
inputText.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAction(); } };
sendBtn.onclick = handleAction;

init();
