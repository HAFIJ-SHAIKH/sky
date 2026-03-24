import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// MODEL 1: Agent (Fast, Reasoning, Tools)
// Using the specific ID requested.
// Fallback: Qwen2.5-1.5B-Instruct (Base model) if ID not found.
const AGENT_MODEL = {
    id: "DeepSeek-R1-Distill-Qwen-1.5B-q4f16_1-MLC",
    fallback_id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Agent",
};

// MODEL 2: Core (Smart, Creative, Complex)
const CORE_MODEL = {
    id: "Llama-3-8B-Instruct-q4f16_1-MLC",
    name: "Core",
};

const AGENT_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, a fast reasoning agent created by ${OPENSKY_CONFIG.creator}.

RULES:
1. Think inside <think...</think tags.
2. If the task is simple or requires tools: handle it yourself.
   - Tool format: ACTION: tool_name ARGS: value
3. If the task is COMPLEX (coding, long essays, complex math): Output exactly: [ROUTE_TO_CORE]
   Then stop immediately.

TOOLS:
wiki(topic), weather(city), define(word), country(name), pokemon(name), joke(), advice(), bored().
`;

const CORE_PROMPT = `
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
let coreEngine = null; 
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
// 4. LOGIC (ReAct Loop)
// ==========================================

function smartScroll() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function createMessageUI(title) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    
    const panel = document.createElement('div');
    panel.className = 'agent-panel open';
    panel.innerHTML = `<div class="agent-header"><span>${title}</span><small style="opacity:0.5">▼</small></div><div class="agent-body">Processing...</div>`;
    panel.querySelector('.agent-header').onclick = () => panel.classList.toggle('open');

    const content = document.createElement('div');
    content.className = 'assistant-content';

    msgDiv.appendChild(panel);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    smartScroll();
    
    return { msgDiv, content, panel };
}

async function runAgentLoop(query) {
    const { msgDiv, content, panel } = createMessageUI("⚡ Agent (DeepSeek)");
    const status = panel.querySelector('span');
    const body = panel.querySelector('.agent-body');

    try {
        const messages = [
            { role: "system", content: AGENT_PROMPT },
            ...conversationHistory
        ];

        if (currentImageBase64) {
            messages.push({ role: "user", content: `[Image Uploaded] ${query}. (Process description).` });
        } else {
            messages.push({ role: "user", content: query });
        }

        let loops = 0;
        let finalResponse = "";
        
        while (loops < 3) {
            status.textContent = loops === 0 ? "⚡ Agent Reasoning..." : "🔧 Using Tool...";
            
            const completion = await agentEngine.chat.completions.create({
                messages: messages,
                temperature: 0.7,
                repetition_penalty: 1.1,
                stream: true
            });

            let currentChunk = "";
            for await (const chunk of completion) {
                if (!isGenerating) break;
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    currentChunk += delta;
                    body.textContent = currentChunk;
                    parseAndRender(currentChunk, content);
                    smartScroll();
                }
            }
            
            // Case A: Route to Core (Smart Model)
            if (currentChunk.includes("[ROUTE_TO_CORE]")) {
                status.textContent = "🧠 Routing to Core...";
                body.textContent += "\n\n-> Handing off to Core Model...";
                
                // Load Core Engine if not loaded (should be loaded by init, but safety check)
                if (!coreEngine) {
                     content.innerHTML += `<div class="tool-result">Core Engine not ready. Please wait...</div>`;
                     // We could await loading here, but init() handles it now.
                     return; 
                }

                const coreMessages = [
                    { role: "system", content: CORE_PROMPT },
                    ...conversationHistory,
                    { role: "user", content: query } // Send original query
                ];

                const coreUI = createMessageUI("🧠 Core (Llama-3 8B)");
                const coreContent = coreUI.content;
                const coreBody = coreUI.panel.querySelector('.agent-body');

                const coreStream = await coreEngine.chat.completions.create({
                    messages: coreMessages, temperature: 0.7, stream: true
                });

                let coreText = "";
                for await (const chunk of coreStream) {
                    if (!isGenerating) break;
                    const delta = chunk.choices[0].delta.content;
                    if (delta) {
                        coreText += delta;
                        coreBody.textContent = coreText;
                        parseAndRender(coreText, coreContent);
                        smartScroll();
                    }
                }
                
                conversationHistory.push({ role: "user", content: query });
                conversationHistory.push({ role: "assistant", content: coreText });
                return;
            }

            // Case B: Needs Tools
            const toolCall = parseToolAction(currentChunk);
            if (toolCall) {
                status.textContent = "🔧 Using Tool...";
                let toolResult;
                if (Tools[toolCall.name]) toolResult = await Tools[toolCall.name](toolCall.args);
                else toolResult = { text: "Unknown tool" };

                content.innerHTML += `<div class="tool-result"><b>Tool Result:</b> ${toolResult.text}</div>`;
                
                messages.push({ role: "assistant", content: currentChunk });
                messages.push({ role: "user", content: `OBSERVATION: ${JSON.stringify(toolResult.text)}. Now answer.` });
                loops++;
            } else {
                finalResponse = currentChunk;
                break;
            }
        }

        conversationHistory.push({ role: "user", content: query });
        conversationHistory.push({ role: "assistant", content: finalResponse });

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
// 6. INITIALIZATION (Sequential Download)
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
          <div class="model-card" id="card-agent">
            <div class="model-card-name">${AGENT_MODEL.name}</div>
            <div class="model-card-desc" id="status-agent">Waiting...</div>
          </div>
          <div class="model-card" id="card-core">
            <div class="model-card-name">${CORE_MODEL.name}</div>
            <div class="model-card-desc" id="status-core">Queued...</div>
          </div>
        `;

        // --- 1. Load Agent (DeepSeek R1) ---
        loadingLabel.textContent = `Loading Agent (DeepSeek R1)...`;
        try {
            agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
                initProgressCallback: (report) => {
                    const p = Math.round(report.progress * 100);
                    // Fill 0% to 50% of the total bar
                    sliderFill.style.width = `${p / 2}%`;
                    loadingPercent.textContent = `${p}%`;
                    document.getElementById('status-agent').textContent = report.text;
                }
            });
        } catch (err) {
            // Fallback if DeepSeek ID is not found
            console.warn("DeepSeek R1 ID not found, falling back to Qwen2.5 Base Model.");
            document.getElementById('status-agent').textContent = "Fallback (Qwen)";
            agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.fallback_id, {
                initProgressCallback: (report) => {
                    const p = Math.round(report.progress * 100);
                    sliderFill.style.width = `${p / 2}%`;
                    loadingPercent.textContent = `${p}%`;
                    document.getElementById('status-agent').textContent = report.text;
                }
            });
        }
        document.getElementById('status-agent').textContent = "Ready";

        // --- 2. Load Core (Llama-3 8B) ---
        loadingLabel.textContent = `Loading Core (Llama-3 8B)...`;
        coreEngine = await webllm.CreateMLCEngine(CORE_MODEL.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                // Fill 50% to 100% of the total bar
                sliderFill.style.width = `${50 + (p / 2)}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('status-core').textContent = report.text;
            }
        });
        document.getElementById('status-core').textContent = "Ready";

        loadingLabel.textContent = "System Online.";
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
        if(coreEngine) await coreEngine.interruptGenerate();
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
