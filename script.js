import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    agent_name: "Opensky",
    creator: "Hafij Shaikh"
};

const AGENT_MODEL = {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Agent",
};

// SYSTEM PROMPT: Optimized for Hinglish & Stability
const SYSTEM_PROMPT = `
You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}.

### LANGUAGE RULES ###
- Tum Hinglish (Hindi + English mix) mein baat karte ho.
- Formal English mat bolo. Casual aur friendly raho.
- Example: "Main bilkul badhiya hoon! Aap batao, aaj kya plan hai?"
- User ke text ko repeat mat karo (Do not repeat user text).

### TOOL RULES ###
- Use tools ONLY for real-time data (Weather, Wiki, Charts).
- FORMAT: ACTION: tool_name ARGS: json_data

AVAILABLE TOOLS:
- get_wiki(topic)
- create_profile_chart(items) -> Use for "Scientists with photos"
- get_weather(city)
- generate_chart(data)
- get_crypto(id)

If no tool is needed, just answer normally in Hinglish.
`;

let conversationHistory = []; // Global history
const MAX_HISTORY = 10; 

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
let isResetting = false; // Flag to block input during reset

// Smooth Progress
let currentProgress = 0;
let targetProgress = 0;
let animationFrameId = null;

// ==========================================
// 3. TOOLS
// ==========================================
const Tools = {
    get_wiki: async (args) => {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.topic)}`);
        const d = await res.json();
        return { text: d.extract, image: d.thumbnail?.source };
    },
    get_weather: async (args) => {
        const city = args.city;
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}`)).json();
        if(!geo.results?.[0]) return { text: "City nahi mili." };
        const { latitude, longitude, name } = geo.results[0];
        const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`)).json();
        return { text: `${name} mein temperature ${w.current_weather.temperature}°C hai.` };
    },
    create_profile_chart: async (args) => {
        return { text: "Profiles ban gaye hain.", profile: args.items };
    },
    generate_chart: async (args) => {
        return { 
            text: "Chart ban gaya.", 
            chart: { type: args.type || 'bar', labels: args.labels, values: args.values } 
        };
    },
    get_crypto: async (args) => {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${args.id}&vs_currencies=usd`);
        const d = await res.json();
        if(d[args.id]) return { text: `${args.id} ka price $${d[args.id].usd} hai.` };
        return { text: "Coin nahi mila." };
    }
};

function parseToolAction(text) {
    const match = text.match(/ACTION:\s*(\w+)\s*ARGS:\s*([\s\S]+)/i);
    if (match) {
        try {
            const jsonMatch = match[2].match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return { name: match[1].toLowerCase(), args: JSON.parse(jsonMatch[0]) };
            }
        } catch (e) { console.log("Parse Error", e); }
    }
    return null;
}

// ==========================================
// 4. SMOOTH LOADING
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
        // History Check
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
                messages: messages, temperature: 0.7, stream: true
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
            
            // Parse Markdown once stream is done for this turn
            parseAndRender(finalResponse, content);

            const toolCall = parseToolAction(currentChunk);
            if (toolCall) {
                statusText.textContent = "Tool chal raha hai...";
                
                let result = { text: "Error" };
                if (Tools[toolCall.name]) result = await Tools[toolCall.name](toolCall.args);
                
                let resultHtml = `<div class="tool-result"><b>Result:</b> ${result.text}</div>`;
                
                if (result.image) resultHtml += `<img src="${result.image}" style="max-width:100%; border-radius:8px; margin-top:5px;">`;
                if (result.profile) {
                    resultHtml += `<div class="profile-grid">`;
                    result.profile.forEach(p => {
                        resultHtml += `<div class="profile-card">
                            <img src="${p.image}" class="profile-img">
                            <div class="profile-info"><h3>${p.name}</h3><p>${p.desc || ''}</p></div>
                        </div>`;
                    });
                    resultHtml += `</div>`;
                }
                if (result.chart) {
                    const chartId = 'chart_' + Math.random().toString(36).substr(2, 9);
                    resultHtml += `<div class="chart-card"><canvas id="${chartId}"></canvas></div>`;
                    setTimeout(() => {
                        const ctx = document.getElementById(chartId);
                        if(ctx) new Chart(ctx, { 
                            type: result.chart.type || 'bar', 
                            data: { labels: result.chart.labels, datasets: [{ label: 'Data', data: result.chart.values, borderColor: '#000', backgroundColor: 'rgba(0,0,0,0.1)' }] },
                            options: { responsive: true, maintainAspectRatio: false }
                        });
                    }, 100);
                }

                content.innerHTML += resultHtml;
                
                messages.push({ role: "assistant", content: currentChunk });
                messages.push({ role: "user", content: `Observation: ${result.text}` });
                
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
        isResetting = false; // Release lock
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
        currentProgress = 0; targetProgress = 0;
        animationFrameId = requestAnimationFrame(animateProgress);

        agentEngine = await webllm.CreateMLCEngine(AGENT_MODEL.id, {
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
    // CASE 1: STOP BUTTON
    if (isGenerating) {
        console.log("Stopping...");
        isGenerating = false; // Stop the stream
        isResetting = true;   // Block new inputs
        sendBtn.innerHTML = "Resetting...";
        
        if(agentEngine) {
            try {
                await agentEngine.interruptGenerate();
                await agentEngine.resetChat();
                // CRITICAL: Clear history to prevent corruption on next message
                conversationHistory = []; 
                console.log("Engine Reset Complete.");
            } catch(e) { console.log("Reset error", e); }
        }
        
        sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
        isResetting = false;
        return;
    }

    // CASE 2: BLOCK IF RESETTING
    if (isResetting) return;

    // CASE 3: SEND MESSAGE
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
