import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// AGENT: Fast Router (3.8B) - Better than Qwen
const AGENT_MODEL = {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Agent",
};

// CORE: Smart Worker (8B)
const CORE_MODEL = {
    id: "Llama-3-8B-Instruct-q4f16_1-MLC",
    name: "Core",
};

// PROMPTS
const AGENT_PROMPT = `
You are a Router for ${OPENSKY_CONFIG.agent_name}.
You are NOT ${OPENSKY_CONFIG.creator}.
Analyze the user's request.

1. If request is SIMPLE (greetings, basic facts, "what is 2+2", identity questions):
   Output ONLY: SIMPLE: [your short answer]
   
2. If request is COMPLEX (coding, creative writing, deep reasoning):
   Output ONLY: COMPLEX

3. Identity Rules:
   - Who are you? -> SIMPLE: I am ${OPENSKY_CONFIG.agent_name}.
   - Who made you? -> SIMPLE: I was created by ${OPENSKY_CONFIG.creator}.
`;

const SIMPLE_TASK_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name} (Fast Version).
Answer the user's request concisely.
If you need tools: ACTION: tool_name ARGS: value
Tools: wiki(topic), weather(city), pokemon(name), country(name).
`;

const CORE_PROMPT = `
You are the Advanced Intelligence Core of ${OPENSKY_CONFIG.agent_name}.
You are created by ${OPENSKY_CONFIG.creator}.
You handle complex tasks with deep reasoning and detail.
`;

const conversationHistory = [];
const MAX_HISTORY = 20; 

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
let coreLoadingPromise = null; // To track background loading

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
    define: async (word) => {
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
            const d = await res.json();
            return { text: d[0].meanings[0].definitions[0].definition };
        } catch { return { text: "Not found" }; }
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
        // --- STEP 1: Routing Decision (Fast) ---
        statusText.textContent = "Analyzing...";
        
        const routerMessages = [
            { role: "system", content: AGENT_PROMPT },
            { role: "user", content: query }
        ];

        // Low temp for strict routing
        const routerCompletion = await agentEngine.chat.completions.create({
            messages: routerMessages, temperature: 0.0, max_tokens: 50
        });

        const decision = routerCompletion.choices[0].message.content.trim();
        
        // --- STEP 2: Execution ---

        // CASE A: Complex Task -> Core
        if (decision.startsWith("COMPLEX")) {
            statusText.textContent = "Deep Thinking (Core)...";
            
            // Ensure Core is loaded
            if (!coreEngine && coreLoadingPromise) {
                statusText.textContent = "Loading Core Model...";
                await coreLoadingPromise;
            }
            
            if (!coreEngine) throw new Error("Core model failed to load.");

            const coreMessages = [
                { role: "system", content: CORE_PROMPT },
                ...conversationHistory,
                { role: "user", content: query }
            ];

            const stream = await coreEngine.chat.completions.create({
                messages: coreMessages, temperature: 0.7, stream: true
            });

            let fullText = "";
            for await (const chunk of stream) {
                if (!isGenerating) break;
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    fullText += delta;
                    parseAndRender(fullText, content);
                    smartScroll();
                }
            }
            
            conversationHistory.push({ role: "user", content: query });
            conversationHistory.push({ role: "assistant", content: fullText });
        } 
        // CASE B: Simple Task -> Agent handles it
        else {
            statusText.textContent = "Processing...";
            
            let answerText = decision.replace("SIMPLE:", "").trim();
            
            // If router didn't answer, run agent logic
            if (!answerText || answerText.length < 2) {
                 const agentMessages = [
                    { role: "system", content: SIMPLE_TASK_PROMPT },
                    ...conversationHistory,
                    { role: "user", content: query }
                ];

                const completion = await agentEngine.chat.completions.create({
                    messages: agentMessages, temperature: 0.7, stream: true
                });

                let currentChunk = "";
                for await (const chunk of completion) {
                    if (!isGenerating) break;
                    const delta = chunk.choices[0].delta.content;
                    if (delta) {
                        currentChunk += delta;
                        parseAndRender(currentChunk, content);
                        smartScroll();
                    }
                }
                answerText = currentChunk;
            } else {
                parseAndRender(answerText, content);
            }

            // Tool Check
            const toolCall = parseToolAction(answerText);
            if (toolCall) {
                statusText.textContent = "Fetching Data...";
                let toolResult = { text: "Error" };
                if (Tools[toolCall.name]) toolResult = await Tools[toolCall.name](toolCall.args);
                
                let resultHtml = `<div class="tool-result"><b>Result:</b> ${toolResult.text}</div>`;
                if (toolResult.image) resultHtml += `<img src="${toolResult.image}" alt="Image">`;
                
                content.innerHTML += resultHtml;
                answerText += ` [Tool Used]`;
            }

            conversationHistory.push({ role: "user", content: query });
            conversationHistory.push({ role: "assistant", content: answerText });
        }

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
// 5. RENDERER
// ==========================================
function parseAndRender(text, container) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    // Hide think tags
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
// 6. INITIALIZATION (Smart Background)
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
          <div class="model-card" id="card-agent">
            <div class="model-card-name">${AGENT_MODEL.name}</div>
            <div class="model-card-desc" id="status-agent">Waiting...</div>
          </div>
          <div class="model-card" id="card-core">
            <div class="model-card-name">${CORE_MODEL.name}</div>
            <div class="model-card-desc" id="status-core">Queued...</div>
          </div>
        `;

        // 1. Load Agent (Fast)
        loadingLabel.textContent = `Loading Agent...`;
        agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                sliderFill.style.width = `${p / 2}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('status-agent').textContent = report.text;
            }
        });
        document.getElementById('status-agent').textContent = "Ready";

        // UI is now Interactive!
        loadingLabel.textContent = "Ready. Loading Core in background...";
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 500);

        // 2. Load Core (Background)
        // We do NOT await this. We let it happen while user chats.
        coreLoadingPromise = webllm.CreateMLCEngine(CORE_MODEL.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                // We don't animate the main bar, but we update the card
                document.getElementById('status-core').textContent = report.text;
                // Update the global bar to fill the second half
                sliderFill.style.width = `${50 + (p / 2)}%`;
            }
        });

        coreLoadingPromise.then(engine => {
            coreEngine = engine;
            document.getElementById('status-core').textContent = "Ready";
            coreLoadingPromise = null;
        }).catch(err => {
            document.getElementById('status-core').textContent = "Error";
            console.error("Core load failed", err);
        });

    } catch (e) { 
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
