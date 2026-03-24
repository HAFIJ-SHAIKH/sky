import * as webllm from "@mlc-ai/web-llm";
import { StateGraph, END } from "@langchain/langgraph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// ROUTER: Small, Fast, Efficient
const ROUTER_CONFIG = {
    id: "Phi-3-mini-4k-instruct-q4f16_1-MLC", 
    name: "Phi-3 Mini",
    role: "Router"
};

// WORKER: Large, Smart, Heavy (Lazy Loaded)
const WORKER_CONFIG = {
    id: "Llama-3-8B-Instruct-q4f16_1-MLC",
    name: "Llama-3 8B",
    role: "Worker"
};

// Prompts
const ROUTER_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, a fast routing agent. 
Your job is to classify the user's intent.
1. If the request is simple (greetings, simple questions, basic tool use), respond directly.
2. If the request is complex (coding, math, complex reasoning, creative writing), output exactly: [ROUTE_TO_WORKER]
3. To use tools, output: ACTION: tool_name ARGS: value
Keep responses brief.
`;

const WORKER_PROMPT = `
You are the advanced reasoning core of ${OPENSKY_CONFIG.agent_name}.
You handle complex tasks, coding, mathematics, and detailed creative requests.
You have access to tools: ACTION: tool_name ARGS: value
Be thorough and detailed.
`;

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
const uploadBtn = document.getElementById('uploadBtn');
const imageInput = document.getElementById('imageInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');
const statusBadge = document.getElementById('statusBadge');

let routerEngine = null;
let workerEngine = null;
let isGenerating = false;
let currentImageBase64 = null;
let workerLoaded = false;

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
    joke: async () => {
        const d = await (await fetch("https://v2.jokeapi.dev/joke/Any?type=single")).json();
        return { text: d.joke };
    },
    ocr: async (base64) => {
        try {
            const result = await Tesseract.recognize(`data:image/jpeg;base64,${base64}`, 'eng');
            return { text: result.data.text || "No text found." };
        } catch(e) { return { text: "OCR failed" }; }
    }
    // Add other tools from original code here...
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
    routeDecision: { value: (x, y) => y ?? x, default: () => null }
};

// NODE: Router (Fast)
async function routerNode(state) {
    statusBadge.textContent = "Routing...";
    const history = state.messages;
    const messages = [
        { role: "system", content: ROUTER_PROMPT },
        ...history.map(m => ({ role: m._getType(), content: m.content }))
    ];

    const stream = await routerEngine.chat.completions.create({
        messages, temperature: 0.1, stream: true
    });

    let fullText = "";
    // We create the UI container here
    const msgDiv = createMessageUI();
    const content = msgDiv.querySelector('.assistant-content');
    const body = msgDiv.querySelector('.agent-body');

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
    
    // Check for handoff
    if (fullText.includes("[ROUTE_TO_WORKER]")) {
        updateStatusBadge(msgDiv, "Routing to Worker...");
        return { routeDecision: "worker", messages: [new AIMessage("Routing to advanced core...")] };
    }

    // Check for tools
    const toolCall = parseToolAction(fullText);
    if (toolCall) return { routeDecision: "tools", messages: [new AIMessage(fullText)] };

    return { routeDecision: END, messages: [new AIMessage(fullText)] };
}

// NODE: Worker (Heavy)
async function workerNode(state) {
    statusBadge.textContent = "Thinking (Llama-3)";
    
    // Lazy Load Worker if not ready
    if (!workerEngine) {
        appendSystemMessage("Loading Heavy Model (Llama-3 8B)...");
        try {
            workerEngine = await webllm.CreateMLCEngine(WORKER_CONFIG.id);
            workerLoaded = true;
        } catch(e) {
            return { messages: [new AIMessage("Failed to load heavy model: " + e.message)] };
        }
    }

    const messages = [
        { role: "system", content: WORKER_PROMPT },
        ...state.messages.map(m => ({ role: m._getType(), content: m.content }))
    ];

    const stream = await workerEngine.chat.completions.create({
        messages, temperature: 0.7, stream: true
    });

    let fullText = "";
    const msgDiv = createMessageUI();
    const content = msgDiv.querySelector('.assistant-content');
    const body = msgDiv.querySelector('.agent-body');

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
    
    // Check if worker wants tools
    const toolCall = parseToolAction(fullText);
    if (toolCall) return { routeDecision: "tools", messages: [new AIMessage(fullText)] };

    return { routeDecision: END, messages: [new AIMessage(fullText)] };
}

// NODE: Tools
async function toolNode(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    const text = lastMessage.content;
    const toolCall = parseToolAction(text);
    
    if (!toolCall) return { messages: [new HumanMessage("Tool format error")] };

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
        routeDecision: "router" // Go back to router to process result
    };
}

// ROUTING LOGIC
function checkRoute(state) {
    return state.routeDecision || END;
}

// Build Graph
let app;
async function initGraph() {
    const workflow = new StateGraph({ channels: agentState });
    
    workflow.addNode("router", routerNode);
    workflow.addNode("worker", workerNode);
    workflow.addNode("tools", toolNode);
    
    workflow.setEntryPoint("router");
    
    // Edges
    workflow.addConditionalEdges("router", checkRoute);
    workflow.addConditionalEdges("worker", checkRoute);
    workflow.addEdge("tools", "router"); // After tool, back to router
    
    app = workflow.compile();
}

// ==========================================
// 5. INIT & DOWNLOAD FIX
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

        // Render Model Cards
        modelStatusContainer.innerHTML = `
          <div class="model-card">
            <div>
                <div class="model-card-name">${ROUTER_CONFIG.name}</div>
                <div class="model-card-desc">Router • Fast</div>
            </div>
            <div class="model-card-status" id="status-router">Waiting</div>
          </div>
          <div class="model-card">
             <div>
                <div class="model-card-name">${WORKER_CONFIG.name}</div>
                <div class="model-card-desc">Worker • Lazy Load</div>
            </div>
            <div class="model-card-status" id="status-worker">Standby</div>
          </div>
        `;

        loadingLabel.textContent = `Downloading Router (${ROUTER_CONFIG.name})...`;
        
        // FIX: Proper callback usage to ensure progress bar moves
        routerEngine = await webllm.CreateMLCEngine(ROUTER_CONFIG.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                sliderFill.style.width = `${p}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('status-router').textContent = `${p}%`;
                
                // Detailed logging for debug
                if(report.text) console.log(report.text);
            }
        });

        document.getElementById('status-router').textContent = "Active";
        loadingLabel.textContent = "Router Ready. System Online.";
        
        await initGraph();

        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
            statusBadge.textContent = "Ready";
        }, 500);

    } catch (e) { 
        showError("Initialization Failed", e); 
    }
}

// ==========================================
// 6. UI HELPERS
// ==========================================
function createMessageUI() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    const panel = document.createElement('div');
    panel.className = 'agent-panel open';
    panel.innerHTML = `<div class="agent-header"><span>⚡ Processing...</span></div><div class="agent-body"></div>`;
    panel.querySelector('.agent-header').onclick = () => panel.classList.toggle('open');
    const content = document.createElement('div');
    content.className = 'assistant-content';
    msgDiv.appendChild(panel);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    return msgDiv;
}

function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `<div class="assistant-content" style="font-style:italic; color:var(--text-muted)">${text}</div>`;
    messagesArea.appendChild(div);
    smartScroll();
}

function appendToolResult(result) {
    const lastContent = messagesArea.querySelector('.message:last-child .assistant-content');
    if(lastContent) {
        let html = `<div class="tool-result"><b>Tool Result:</b> ${result.text}</div>`;
        lastContent.innerHTML += html;
    }
}

function updateStatusBadge(msgDiv, text) {
    const span = msgDiv.querySelector('.agent-header span');
    if(span) span.textContent = text;
}

function smartScroll() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function parseAndRender(text, container) {
    // Same renderer logic as before (Chart, Code, Table)
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // ... (Copy the parseAndRender logic from previous code here)
    // For brevity, assuming basic text:
    container.innerHTML = html.replace(/\n/g, '<br>');
}

// ==========================================
// 7. EVENTS
// ==========================================
// Copy event handlers from previous code (handleAction, uploadBtn events)
// Ensure handleAction calls: await app.stream({ messages: [...], imageData: ... })

// ... (Include the event listeners from the previous full code block) ...
// Key change in handleAction:
/*
    const stream = await app.stream({ messages: [new HumanMessage(text)], imageData: imageForGraph });
    for await (const event of stream) { ... }
*/

init();
