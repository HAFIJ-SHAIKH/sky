import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

// MODEL: Qwen 2.5 3B
const AGENT_MODEL = {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 3B",
};

// CUSTOM CONFIG
const myAppConfig = {
  model_list: [
    {
      model_id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
      model: "https://huggingface.co",
      model_lib: webllm.modelLibURLPrefix + webllm.modelVersion + "/Qwen2.5-3B-Instruct-q4f16_1-wasm-ot.wasm",
    },
  ],
};

// SYSTEM PROMPT: Strict Identity & Execution
const SYSTEM_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, an AI assistant.
You were created by ${OPENSKY_CONFIG.creator}.

### IDENTITY RULES ###
1. You are an AI. You are ${OPENSKY_CONFIG.agent_name}.
2. You are NOT Qwen, ChatGPT, or any other model.
3. If asked your name: "I am ${OPENSKY_CONFIG.agent_name}, an AI assistant."
4. If asked your creator: "I was created by ${OPENSKY_CONFIG.creator}."

### BEHAVIOR RULES ###
1. Do NOT explain how you do things.
2. Do NOT say "I will use a tool". Just use it.
3. Execute tasks immediately.

### TOOLS ###
Use tools for real-time data, charts, or images.
FORMAT: ACTION: tool_name ARGS: arguments

TOOLS:
- get_wiki(topic) -> Returns info and IMAGE.
- get_weather(city)
- get_pokemon(name) -> Returns IMAGE.
- get_country(name) -> Returns IMAGE.
- generate_chart(type, labels, data) -> Creates a chart.
`;

const conversationHistory = [];
const MAX_HISTORY = 12; 

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

// Smooth Progress
let currentProgress = 0;
let targetProgress = 0;
let animationFrameId = null;

// ==========================================
// 3. TOOLS
// ==========================================
const Tools = {
    get_wiki: async (topic) => {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`);
        const d = await res.json();
        return { text: d.extract, image: d.thumbnail?.source };
    },
    get_weather: async (city) => {
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}`)).json();
        if(!geo.results?.[0]) return { text: "City not found" };
        const { latitude, longitude, name } = geo.results[0];
        const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`)).json();
        return { text: `Weather in ${name}: ${w.current_weather.temperature}°C` };
    },
    get_pokemon: async (name) => {
        try {
            const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
            const d = await res.json();
            return { text: `#${d.id} ${d.name}`, image: d.sprites?.front_default };
        } catch { return { text: "Pokemon not found" }; }
    },
    get_country: async (name) => {
        try {
            const res = await fetch(`https://restcountries.com/v3.1/name/${name}`);
            const d = await res.json();
            return { text: `${d[0].name.common}, Capital: ${d[0].capital}`, image: d[0].flags?.svg };
        } catch { return { text: "Country not found" }; }
    },
    get_crypto: async (id) => {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
        const d = await res.json();
        if(d[id]) return { text: `${id} is $${d[id].usd}` };
        return { text: "Coin not found" };
    },
    generate_chart: async (args) => {
        try {
            const parts = args.match(/(\w+),\s*(\[.*?\]),\s*(\[.*?\])/i);
            if(!parts) return { text: "Invalid chart format." };
            
            return { 
                text: "Chart generated.", 
                chart: {
                    type: parts[1],
                    labels: JSON.parse(parts[2]),
                    data: JSON.parse(parts[3])
                }
            };
        } catch(e) {
            return { text: "Chart error: " + e.message };
        }
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
        while (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.shift();

        let messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...conversationHistory,
            { role: "user", content: query }
        ];

        let finalResponse = "";
        let loops = 0;
        let forceStop = false;

        while (loops < 5 && !forceStop) { 
            if (!isGenerating) { forceStop = true; break; }

            const completion = await agentEngine.chat.completions.create({
                messages: messages, 
                temperature: 0.05, 
                stream: true
            });

            let currentChunk = "";
            let textNode = document.createTextNode("");
            content.appendChild(textNode);

            for await (const chunk of completion) {
                if (!isGenerating) { forceStop = true; break; }
                
                const delta = chunk.choices[0].delta.content;
                if (delta) {
                    currentChunk += delta;
                    finalResponse += delta;
                    textNode.nodeValue += delta;
                    smartScroll();
                }
            }

            if (forceStop) break;

            parseAndRender(finalResponse, content);

            const toolCall = parseToolAction(currentChunk);
            if (toolCall) {
                statusText.textContent = "Running Tool...";
                
                let result = { text: "Error" };
                if (Tools[toolCall.name]) result = await Tools[toolCall.name](toolCall.args);
                
                let resultHtml = `<div class="tool-result"><b>Result:</b> ${result.text}</div>`;
                
                if (result.image) {
                    resultHtml += `<img src="${result.image}" alt="img" style="max-width:100%; border-radius:8px; margin-top:8px; display:block;">`;
                }
                
                if (result.chart) {
                    const chartId = 'chart_' + Math.random().toString(36).substr(2, 9);
                    resultHtml += `<div style="height:250px; margin-top:10px;"><canvas id="${chartId}"></canvas></div>`;
                    setTimeout(() => {
                        const ctx = document.getElementById(chartId);
                        if(ctx) new Chart(ctx, { 
                            type: result.chart.type || 'bar', 
                            data: { labels: result.chart.labels, datasets: [{ label: 'Data', data: result.chart.data, borderColor: '#000', backgroundColor: 'rgba(0,0,0,0.1)' }] },
                            options: { responsive: true, maintainAspectRatio: false }
                        });
                    }, 100);
                }

                content.innerHTML += resultHtml;
                
                messages.push({ role: "assistant", content: currentChunk });
                messages.push({ role: "user", content: `Observation: ${result.text}. Answer now.` });
                
                finalResponse = ""; 
                loops++;
            } else {
                break; 
            }
        }

        conversationHistory.push({ role: "user", content: query });
        conversationHistory.push({ role: "assistant", content: finalResponse });

        status.style.display = 'none';

    } catch (e) {
        if (!e.message.includes("interrupt")) {
            content.innerHTML += `<span style="color:red">Error: ${e.message}</span>`;
        }
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

        cancelAnimationFrame(animationFrameId);
        currentProgress = 0;
        targetProgress = 0;
        animationFrameId = requestAnimationFrame(animateProgress);

        agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
            appConfig: myAppConfig,
            initProgressCallback: (report) => {
                targetProgress = report.progress * 100;
                document.getElementById('status-agent').textContent = report.text;
            }
        });

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
        sendBtn.innerHTML = `Stopping...`;
        
        if(agentEngine) {
            await agentEngine.interruptGenerate();
            // Critical fix for Qwen: Reset chat state after stop
            await agentEngine.resetChat(); 
        }
        
        sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
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
