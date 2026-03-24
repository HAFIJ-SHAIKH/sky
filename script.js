import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// MODEL 1: The Agent (Fast, Reasoning, Tools)
const AGENT_MODEL = {
    id: "DeepSeek-R1-Distill-Qwen-1.5B-q4f16_1-MLC", 
    name: "DeepSeek R1 1.5B",
    role: "Agent"
};

// MODEL 2: The Worker (Smart, Creative, Complex)
const WORKER_MODEL = {
    id: "Llama-3-8B-Instruct-q4f16_1-MLC", 
    name: "Llama-3 8B",
    role: "Worker"
};

const AGENT_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, a fast reasoning agent created by ${OPENSKY_CONFIG.creator}.

RULES:
1. Think inside <think...</think tags.
2. If the task is simple or requires tools: handle it yourself.
   - Tool format: ACTION: tool_name ARGS: value
3. If the task is COMPLEX (coding, long essays, complex math): Output exactly: [ROUTE_TO_SMART]
   Then stop immediately.

TOOLS:
wiki(topic), weather(city), define(word), country(name), pokemon(name), joke(), advice(), bored().
`;

const WORKER_PROMPT = `
You are the Advanced Intelligence Core of ${OPENSKY_CONFIG.agent_name}.
You are brilliant, detailed, and creative. The user has a complex request that requires your superior processing power.
Answer the user's request with high detail and quality.
`;

const conversationHistory = [];
const MAX_HISTORY = 10; 

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

let agentEngine = null;
let workerEngine = null; // Lazy loaded
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

function smartScroll() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// Creates the UI container for messages
function createMessageUI(title) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';

    const panel = document.createElement('div');
    panel.className = 'agent-panel open';
    panel.innerHTML = `<div class="agent-header"><span>${title}</span></div><div class="agent-body">Thinking...</div>`;
    panel.querySelector('.agent-header').onclick = () => panel.classList.toggle('open');

    const content = document.createElement('div');
    content.className = 'assistant-content';

    msgDiv.appendChild(panel);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    smartScroll();

    return { msgDiv, content, panel };
}

// Main Agent Loop
async function runAgentLoop(query) {
    let msgDiv, content, panel;
    
    try {
        const messages = [
            { role: "system", content: AGENT_PROMPT },
            ...conversationHistory
        ];

        if (currentImageBase64) {
            messages.push({ role: "user", content: `[Image Uploaded] ${query}. (Describe it to yourself then proceed).` });
        } else {
            messages.push({ role: "user", content: query });
        }

        // --- STEP 1: Agent Thinks ---
        const ui = createMessageUI("⚡ Agent (DeepSeek R1)");
        msgDiv = ui.msgDiv; content = ui.content; panel = ui.panel;
        const status = panel.querySelector('span');
        const body = panel.querySelector('.agent-body');

        const stream = await agentEngine.chat.completions.create({
            messages: messages,
            temperature: 0.7,
            stream: true
        });

        let agentText = "";
        for await (const chunk of stream) {
            if (!isGenerating) break;
            const delta = chunk.choices[0].delta.content;
            if (delta) {
                agentText += delta;
                body.textContent = agentText;
                parseAndRender(agentText, content);
                smartScroll();
            }
        }

        // --- STEP 2: Decision ---
        
        // Case A: Needs Smart Model
        if (agentText.includes("[ROUTE_TO_SMART]")) {
            status.textContent = "🧠 Handing off to Smart Core...";
            body.textContent += "\n\n[Transferring to Llama-3 8B...]";
            content.innerHTML += `<div class="tool-result">Task complexity high. Loading Smart Model...</div>`;
            
            // Lazy Load Worker
            if (!workerEngine) {
                content.innerHTML += `<div class="tool-result">Downloading Smart Model (one-time setup)...</div>`;
                workerEngine = await webllm.CreateMLCEngine(WORKER_MODEL.id, {
                    initProgressCallback: (report) => {
                        // Simple inline progress for lazy load
                        console.log(`Worker: ${Math.round(report.progress * 100)}%`);
                    }
                });
            }

            // Call Worker
            const workerMessages = [
                { role: "system", content: WORKER_PROMPT },
                ...conversationHistory,
                { role: "user", content: query } // Send original query
            ];

            const workerUI = createMessageUI("🧠 Worker (Llama-3 8B)");
            const workerContent = workerUI.content;
            const workerBody = workerUI.panel.querySelector('.agent-body');

            const workerStream = await workerEngine.chat.completions.create({
                messages: workerMessages, temperature: 0.7, stream: true
            });

            let workerText = "";
            for await (const chunk of workerStream) {
                if (!isGenerating) break;
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    workerText += delta;
                    workerBody.textContent = workerText;
                    parseAndRender(workerText, workerContent);
                    smartScroll();
                }
            }
            
            conversationHistory.push({ role: "user", content: query });
            conversationHistory.push({ role: "assistant", content: workerText });
            return;
        }

        // Case B: Needs Tools
        const toolCall = parseToolAction(agentText);
        if (toolCall) {
            status.textContent = "🔧 Using Tool...";
            let toolResult;
            if (Tools[toolCall.name]) toolResult = await Tools[toolCall.name](toolCall.args);
            else toolResult = { text: "Unknown tool" };

            content.innerHTML += `<div class="tool-result"><b>Tool Result:</b> ${toolResult.text}</div>`;
            
            // Feed back observation
            messages.push({ role: "assistant", content: agentText });
            messages.push({ role: "user", content: `OBSERVATION: ${JSON.stringify(toolResult.text)}. Now answer.` });
            
            // Stream final answer
            status.textContent = "⚡ Final Answer...";
            const finalStream = await agentEngine.chat.completions.create({
                messages: messages, temperature: 0.7, stream: true
            });
            
            let finalText = "";
            body.textContent = ""; // Clear thoughts
            for await (const chunk of finalStream) {
                if (!isGenerating) break;
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    finalText += delta;
                    body.textContent = finalText;
                    parseAndRender(finalText, content);
                    smartScroll();
                }
            }
            
            conversationHistory.push({ role: "user", content: query });
            conversationHistory.push({ role: "assistant", content: finalText });
            return;
        }

        // Case C: Simple Answer
        conversationHistory.push({ role: "user", content: query });
        conversationHistory.push({ role: "assistant", content: agentText });

    } catch (e) {
        if(content) content.innerHTML += `<span style="color:red">Error: ${e.message}</span>`;
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
    // Hide think tags in final render
    html = html.replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/g, ''); 
    
    // Code
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
        if (!navigator.gpu) throw new Error("WebGPU not supported. Use Chrome.");

        modelStatusContainer.innerHTML = `
          <div class="model-card">
            <div class="model-card-name">${AGENT_MODEL.name}</div>
            <div class="model-card-desc" id="model-status">Waiting...</div>
          </div>
          <div class="model-card" style="opacity: 0.5">
            <div class="model-card-name">${WORKER_MODEL.name}</div>
            <div class="model-card-desc">Standby (Lazy Load)</div>
          </div>
        `;

        loadingLabel.textContent = `Downloading Agent (${AGENT_MODEL.name})...`;
        
        agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                sliderFill.style.width = `${p}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('model-status').textContent = report.text;
            }
        });

        document.getElementById('model-status').textContent = "Ready";

        loadingLabel.textContent = "System Ready.";
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 500);

    } catch (e) { 
        showError("Init Failed", e); 
    }
}

// ==========================================
// 7. EVENTS
// ==========================================
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
        if(agentEngine) await agentEngine.interruptGenerate();
        if(workerEngine) await workerEngine.interruptGenerate();
        return;
    }

    const text = inputText.value.trim();
    if (!text && !currentImageBase64) return;

    const userMsg = document.createElement('div');
    userMsg.className = 'message user';
    userMsg.innerHTML = `<div class="user-bubble">${text}</div>`;
    messagesArea.appendChild(userMsg);

    const query = text || "Process this.";
    
    inputText.value = '';
    inputText.style.height = 'auto';

    isGenerating = true;
    sendBtn.classList.add('stop-btn');
    sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
    
    smartScroll();
    await runAgentLoop(query);
    
    currentImageBase64 = null;
    imagePreviewContainer.classList.remove('active');
}

inputText.oninput = function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; };
inputText.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAction(); } };
sendBtn.onclick = handleAction;

init();
