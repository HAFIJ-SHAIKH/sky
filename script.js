import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// MODEL: Qwen 2.5 7B (High Intelligence, 128k Context Support)
const MODEL_CONFIG = {
    id: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 7B",
    // Qwen supports up to 128k, but we limit to 8k for browser stability/memory
    context_window_size: 8192 
};

// ENHANCED PROMPT FOR QWEN 2.5
const SYSTEM_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, a highly advanced AI created by ${OPENSKY_CONFIG.creator}.

CORE IDENTITY:
- Name: ${OPENSKY_CONFIG.agent_name}
- Creator: ${OPENSKY_CONFIG.creator}
- Role: Advanced Reasoning Agent.

CAPABILITIES:
1. **Programming**: You are an expert in 92+ programming languages. Generate clean, efficient code.
2. **Mathematics**: Solve complex mathematical and logical problems step-by-step.
3. **Multilingual**: You speak 29+ languages fluently.
4. **Data Extraction**: You can convert unstructured text into clean JSON or Tables.
5. **Agentic Tasks**: You can use external tools to get real-time data.

TOOL USAGE:
If you need real-time information or specific data, use the following format:
ACTION: tool_name ARGS: value
Available Tools: wiki(topic), weather(city), pokemon(name), country(name), define(word), joke(), advice(), bored().

RULES:
- Always identify yourself as ${OPENSKY_CONFIG.agent_name}.
- Do not hallucinate data. Use tools if you lack information.
- Format data into Markdown tables or JSON when requested.
`;

const conversationHistory = [];
const MAX_HISTORY = 40; 

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

let engine = null;
let isGenerating = false;

// Progress Smoother
let currentProgress = 0;
let targetProgress = 0;
let progressInterval;

function updateProgressSmoothly() {
    if (currentProgress < targetProgress) {
        currentProgress += 0.5; 
        if (currentProgress > targetProgress) currentProgress = targetProgress;
        sliderFill.style.width = `${currentProgress}%`;
        loadingPercent.textContent = `${currentProgress.toFixed(2)}%`;
    }
}

// ==========================================
// 3. TOOLS (Agentic Capabilities)
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
        return { text: `Weather in ${name}: ${w.current_weather.temperature}°C, Wind ${w.current_weather.windspeed} km/h` };
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
        return { text: `#${d.id} ${d.name}, Type: ${d.types.map(t=>t.type.name).join(', ')}`, image: d.sprites?.front_default };
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
        return { text: `${d.activity} (${d.type})` };
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
        let messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...conversationHistory,
            { role: "user", content: query }
        ];

        let fullResponse = "";
        let loops = 0;

        // ReAct Loop (Reason + Act)
        while (loops < 5) {
            if (!isGenerating) break;
            
            statusText.textContent = loops === 0 ? "Thinking..." : "Processing...";

            const completion = await engine.chat.completions.create({
                messages: messages, 
                temperature: 0.7, 
                stream: true
            });

            let currentChunk = "";
            for await (const chunk of completion) {
                if (!isGenerating) break;
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    currentChunk += delta;
                    fullResponse += delta;
                    parseAndRender(fullResponse, content);
                    smartScroll();
                }
            }

            const toolCall = parseToolAction(currentChunk);
            if (toolCall) {
                statusText.textContent = `Using Tool: ${toolCall.name}...`;
                let result = { text: "Error" };
                if (Tools[toolCall.name]) result = await Tools[toolCall.name](toolCall.args);
                
                let resultHtml = `<div class="tool-result"><b>Result:</b> ${result.text}</div>`;
                if (result.image) resultHtml += `<img src="${result.image}">`;
                content.innerHTML += resultHtml;
                
                // Feed back observation
                messages.push({ role: "assistant", content: currentChunk });
                messages.push({ role: "user", content: `OBSERVATION: ${JSON.stringify(result.text)}. Now answer.` });
                fullResponse = ""; // Reset for final answer
                loops++;
            } else {
                // No tool, finished
                break;
            }
        }

        if (isGenerating) {
            conversationHistory.push({ role: "user", content: query });
            conversationHistory.push({ role: "assistant", content: fullResponse });
            // Memory Management
            if (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.splice(0, 2);
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
// 5. RENDERER (Supports Code, Tables, Math)
// ==========================================
function parseAndRender(text, container) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    // Hide think tags
    html = html.replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/g, '');
    
    // Code Blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="code-header"><span>${lang||'code'}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><div class="code-body"><pre>${code}</pre></div></div>`
    );
    
    // Tables (Basic Markdown Support)
    // Regex for markdown tables
    html = html.replace(/^\|(.+)\|\s*\n\|[-:\s|]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm, (match, header, body) => {
        const h = header.split('|').filter(x=>x.trim()).map(x=>`<th>${x.trim()}</th>`).join('');
        const b = body.trim().split('\n').map(row => 
            `<tr>${row.split('|').filter(x=>x.trim()).map(x=>`<td>${x.trim()}</td>`).join('')}</tr>`
        ).join('');
        return `<table><thead><tr>${h}</tr></thead><tbody>${b}</tbody></table>`;
    });

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
            <div class="model-card-name">${MODEL_CONFIG.name}</div>
            <div class="model-card-desc" id="status-model">Waiting...</div>
          </div>
        `;

        // Start smooth updater
        clearInterval(progressInterval);
        progressInterval = setInterval(updateProgressSmoothly, 30);

        loadingLabel.textContent = `Loading Qwen 2.5 7B...`;
        
        engine = await webllm.CreateMLCEngine(MODEL_CONFIG.id, {
            initProgressCallback: (report) => {
                targetProgress = report.progress * 100;
                document.getElementById('status-model').textContent = report.text;
            },
            context_window_size: MODEL_CONFIG.context_window_size // Enable Long Memory
        });

        document.getElementById('status-model').textContent = "Ready";
        
        clearInterval(progressInterval);
        currentProgress = 100;
        sliderFill.style.width = `100%`;
        loadingPercent.textContent = `100.00%`;

        loadingLabel.textContent = "System Online.";
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 500);

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
        if(engine) await engine.interruptGenerate();
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
