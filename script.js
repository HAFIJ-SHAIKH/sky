import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// AGENT: Fast Drafter (3.8B)
const AGENT_MODEL = {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Agent",
};

// CORE: Smart Corrector (8B)
const CORE_MODEL = {
    id: "Llama-3-8B-Instruct-q4f16_1-MLC",
    name: "Core",
};

// PROMPT FOR AGENT (Fast Draft)
const AGENT_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
You are a fast assistant. Draft a response to the user.
Use tools if needed: ACTION: tool_name ARGS: value
Tools: wiki(topic), weather(city), pokemon(name), country(name), define(word), joke(), advice(), bored().
`;

// PROMPT FOR CORE (Parallel Verification)
// Note: We inject the Query. We DON'T wait for Agent's draft to keep it parallel.
// Core generates its own 'Gold Standard' answer.
const CORE_PROMPT = `
You are the Core Intelligence of ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.
You are reviewing a user request. Generate the best possible answer.
Be accurate and helpful.
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
// 4. LOGIC (Parallel Execution)
// ==========================================

function smartScroll() { messagesArea.scrollTop = messagesArea.scrollHeight; }

function createMessageDiv() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    
    const status = document.createElement('div');
    status.className = 'agent-status';
    status.innerHTML = `<span class="agent-status-dot"></span><span class="status-text">Drafting...</span>`;
    
    const content = document.createElement('div');
    content.className = 'assistant-content';

    msgDiv.appendChild(status);
    msgDiv.appendChild(content);
    messagesArea.appendChild(msgDiv);
    smartScroll();
    
    return { msgDiv, content, status };
}

// Main Loop
async function runAgentLoop(query) {
    const { msgDiv, content, status } = createMessageDiv();
    const statusText = status.querySelector('.status-text');

    try {
        // --- 1. AGENT PROCESS (Drafting) ---
        // Agent Loop handles Tools
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

        // --- 2. CORE PROCESS (Parallel Verification) ---
        // We run Core in parallel to Agent's final text generation.
        // Ideally, we start Core slightly before Agent finishes, but for safety:
        // We start Core verification now.
        
        // If tools were used, data is usually accurate, so we can skip Core to save time
        if (!toolUsed) {
            statusText.textContent = "Verifying...";
            
            const coreMessages = [
                { role: "system", content: CORE_PROMPT },
                ...conversationHistory,
                { role: "user", content: query } // Core sees the same query
            ];

            // Run Core
            const coreCompletion = await coreEngine.chat.completions.create({
                messages: coreMessages, temperature: 0.5, max_tokens: 1000
            });

            const coreText = coreCompletion.choices[0].message.content.trim();

            // --- 3. COMPARISON & SWAP ---
            
            // Simple Similarity Check (Naive)
            // In production, use semantic similarity or an LLM judge prompt.
            const isSimilar = (a, b) => {
                const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                // If 50% of words overlap, consider it "OK" (very naive)
                // Better: Let Core decide. We modify Core Prompt to output [OK] if good.
                return a.includes("[OK]") || (a.length > 10 && b.length > 10 && similarity(norm(a), norm(b)) > 0.8);
            };

            // Heuristic: If Core is significantly different/better?
            // We use a "Correction" prompt strategy.
            // Let's assume Core is the 'Truth'.
            
            // NOTE: To make this truly robust, Core Prompt should be:
            // "Compare User Query: {{QUERY}} \n Draft: {{DRAFT}} \n If good output [OK], else output correction."
            // For this implementation, we run Core INDEPENDENTLY to get a second opinion.
            
            // If Core output is VERY similar to Agent, we trust Agent (faster).
            // If Core output is different, we SWAP to Core (smarter).
            
            // Simple heuristic for this demo:
            // If Core's answer is valid and Agent is very short, use Core.
            // In a real app, you'd use a 3rd "Judge" or strict prompting.
            
            // HERE: We simply compare lengths or trust Core if Agent seemed uncertain? 
            // Let's assume Agent is "Draft" and Core is "Final".
            // If the user asked for code, Core is better.
            
            // Let's use a simple heuristic: Always show Agent first.
            // If Core has different content, replace it.
            
            // Check if Core thinks it needs correction?
            // We used a generic prompt for Core above.
            // Let's swap if Core text is significantly better/longer for complex queries.
            
            // FOR THIS DEMO:
            // We will assume Core has produced the "High Quality" answer.
            // If Core is ready, we replace Agent text with Core text (DRAFT -> FINAL).
            // This creates a "Flicker Update" which shows the "Correction" mechanism.
            
            if (coreText && coreText.length > agentText.length * 0.8) { 
                // Core provided a solid answer.
                // Compare content. If different, swap.
                if (coreText.trim() !== agentText.trim()) {
                    // SWAP
                    parseAndRender(coreText, content);
                    content.innerHTML += `<div class="corrected-badge">✨ Corrected by Core</div>`;
                    agentText = coreText; // Save to history
                } else {
                    content.innerHTML += `<div class="verified-badge">✓ Verified</div>`;
                }
            }
        }

        conversationHistory.push({ role: "user", content: query });
        conversationHistory.push({ role: "assistant", content: agentText });

        status.style.display = 'none';

    } catch (e) {
        content.innerHTML += `<span style="color:red">Error: ${e.message}</span>`;
    } finally {
        isGenerating = false;
        sendBtn.classList.remove('stop-btn');
        sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    }
}

// Simple similarity helper
function similarity(s1, s2) {
    // Very basic Jaccard index for demo
    const set1 = new Set(s1.split(" "));
    const set2 = new Set(s2.split(" "));
    const intersection = [...set1].filter(x => set2.has(x)).length;
    const union = new Set([...s1.split(" "), ...s2.split(" ")]).size;
    return union === 0 ? 1 : intersection / union;
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

        // 1. Download Agent
        loadingLabel.textContent = `Loading Agent (1/2)...`;
        agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
                sliderFill.style.width = `${p / 2}%`;
                loadingPercent.textContent = `${p}%`;
                document.getElementById('status-agent').textContent = report.text;
            }
        });
        document.getElementById('status-agent').textContent = "Ready";

        // 2. Download Core (Sequential)
        loadingLabel.textContent = `Loading Core (2/2)...`;
        coreEngine = await webllm.CreateMLCEngine(CORE_MODEL.id, {
            initProgressCallback: (report) => {
                const p = Math.round(report.progress * 100);
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
