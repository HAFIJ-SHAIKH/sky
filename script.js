import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { StateGraph, END } from "https://esm.run/@langchain/langgraph";
import { HumanMessage, AIMessage } from "https://esm.run/@langchain/core/messages";
// ADDED MISSING IMPORT for OCR tool
import Tesseract from 'https://esm.run/tesseract.js';

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// FIXED MODEL CONFIGURATION
// Changed from "Qwen3..." (invalid) to "Qwen2.5-1.5B-Instruct" (valid & fast)
const MODEL_CONFIG = {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", 
    name: "Qwen 2.5 1.5B",
};

const AGENT_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
You are an advanced AI agent with access to tools. You are smart, concise, and helpful.

INSTRUCTIONS:
- If you need real-time data or specific information, use a tool.
- To use a tool, output strictly in this format: ACTION: tool_name ARGS: value
- After receiving an observation, process it and answer the user.
- If you cannot answer with tools, use your internal knowledge.

TOOLS:
wiki(topic), weather(city), define(word), country(name), pokemon(name), joke(), advice(), bored(), ocr(image).
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

let engine = null;
let isGenerating = false;
let currentImageBase64 = null; 

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
    country: async (name) => {
        const res = await fetch(`https://restcountries.com/v3.1/name/${name}`);
        const d = await res.json();
        return { text: `${d[0].name.common}, Capital: ${d[0].capital}`, image: d[0].flags?.svg };
    },
    pokemon: async (name) => {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
        const d = await res.json();
        return { text: `#${d.id} ${d.name}`, image: d.sprites?.front_default };
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
    },
    ocr: async (base64) => {
        if(!base64) return { text: "No image" };
        try {
            const res = await Tesseract.recognize(`data:image/jpeg;base64,${base64}`, 'eng');
            return { text: res.data.text || "No text" };
        } catch(e) { return { text: "OCR Error" }; }
    }
};

function parseToolAction(text) {
    const match = text.match(/ACTION:\s*(\w+)\s*ARGS:\s*([^\n]+)/i);
    if (!match) return null;
    return { name: match[1].toLowerCase(), args: match[2].trim() };
}

// ==========================================
// 4. LANGGRAPH NODES
// ==========================================

function createMessageUI(title) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    
    const panel = document.createElement('div');
    panel.className = 'agent-panel';
    panel.innerHTML = `<div class="agent-header"><span>${title}</span><small style="opacity:0.5">▼</small></div><div class="agent-body">Processing...</div>`;
    panel.querySelector('.agent-header').onclick = () => panel.classList.toggle('open');

    const content = document.createElement('div');
    content.className = 'assistant-content';

    msgDiv.appendChild(panel);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    smartScroll();
    
    return { msgDiv, content };
}

// SINGLE AGENT NODE
async function agentNode(state) {
    const history = state.messages;
    const messages = [
        { role: "system", content: AGENT_PROMPT },
        ...history.map(m => ({ role: m._getType(), content: m.content }))
    ];

    const { msgDiv, content } = createMessageUI("🧠 Opensky");
    const body = msgDiv.querySelector('.agent-body');

    const stream = await engine.chat.completions.create({
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
    
    // Decision Logic
    const toolCall = parseToolAction(fullText);
    if (toolCall) {
        return { nextAction: "tools", messages: [new AIMessage(fullText)] };
    }

    return { nextAction: END, messages: [new AIMessage(fullText)] };
}

async function toolsNode(state) {
    const lastMsg = state.messages[state.messages.length - 1].content;
    const toolCall = parseToolAction(lastMsg);
    
    const { msgDiv, content } = createMessageUI("🔧 Tool Execution");
    content.innerHTML = "Running tool...";

    let result = { text: "Tool not found" };
    if (toolCall) {
        const { name, args } = toolCall;
        if (name === 'ocr') result = await Tools.ocr(state.imageData);
        else if (Tools[name]) result = await Tools[name](args);
    }

    content.innerHTML += `<div class="tool-result"><b>Result:</b> ${result.text}</div>`;
    
    return { 
        nextAction: "agent", 
        messages: [new HumanMessage(`OBSERVATION: ${JSON.stringify(result.text)}. Now answer.`)] 
    };
}

function checkNextAction(state) {
    return state.nextAction || END;
}

// ==========================================
// 5. GRAPH SETUP
// ==========================================
let app;

async function initGraph() {
    const agentStateChannels = {
        messages: { value: (x, y) => x.concat(y), default: () => [] },
        nextAction: { value: (x, y) => y ?? x, default: () => null },
        imageData: { value: (x, y) => y ?? x, default: () => null } 
    };

    const workflow = new StateGraph({ channels: agentStateChannels });
    
    workflow.addNode("agent", agentNode);
    workflow.addNode("tools", toolsNode);
    
    workflow.setEntryPoint("agent");
    
    workflow.addConditionalEdges("agent", checkNextAction);
    workflow.addEdge("tools", "agent");
    
    app = workflow.compile();
}

// ==========================================
// 6. INIT
// ==========================================
function showError(t, e) { 
    debugLog.style.display = 'block'; 
    debugLog.innerHTML = `<strong>${t}:</strong> ${e.message}`; 
    console.error(e);
}

async function init() {
    try {
        loadingLabel.textContent = "Checking WebGPU...";
        if (!navigator.gpu) throw new Error("WebGPU not supported.");

        modelStatusContainer.innerHTML = `
          <div class="model-card">
            <div class="model-card-name">${MODEL_CONFIG.name}</div>
            <div class="model-card-desc" id="model-status">Waiting...</div>
          </div>
        `;

        loadingLabel.textContent = `Downloading ${MODEL_CONFIG.name}...`;
        
        engine = await webllm.CreateMLCEngine(MODEL_CONFIG.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                sliderFill.style.width = `${p}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('model-status').textContent = report.text;
            }
        });

        document.getElementById('model-status').textContent = "Ready";
        await initGraph();

        loadingLabel.textContent = "Ready.";
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 500);

    } catch (e) { 
        showError("Init Failed", e); 
    }
}

function smartScroll() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function parseAndRender(text, container) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="code-header"><span>${lang||'code'}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><div class="code-body"><pre>${code}</pre></div></div>`
    );
    container.innerHTML = html.replace(/\n/g, '<br>');
}

window.copyCode = (btn) => {
    navigator.clipboard.writeText(btn.closest('.code-block').querySelector('pre').textContent);
    btn.textContent = 'Copied';
};

// Events
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
        if(engine) await engine.interruptGenerate();
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
        const stream = await app.stream({ 
            messages: [new HumanMessage(inputWithHint)], 
            imageData: imageForGraph 
        });
        
        for await (const event of stream) {
            if (!isGenerating) break;
        }
    } catch (e) {
        showError("Chat Error", e);
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
