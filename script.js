import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    "agent_name": "Opensky",
    "creator": "Hafij Shaikh", // Fixed Identity
    "version": "10.0.0" // Tool Use Edition
};

// Memory
const conversationHistory = [];
const MAX_HISTORY = 10;

// --- PROMPTS ---

// Fixed Identity Section
const IDENTITY_RULE = `IMPORTANT IDENTITY: You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}. 
If asked who made you, say "${OPENSKY_CONFIG.creator}". 
Never say you are from Pixability, OpenAI, or Google.`;

// Tools Definition
const TOOLS_INSTRUCTION = `
You have access to real-time tools. To use them, output EXACTLY the tag followed by parameters. Do not explain the tag, just output it.
Available Tools:
1. [USE_TOOL:WIKI:topic] - Search Wikipedia for facts.
2. [USE_TOOL:WEATHER:city] - Get weather for a city.
3. [USE_TOOL:DEFINE:word] - Get definition of a word.
4. [USE_TOOL:COUNTRY:name] - Get info about a country.
5. [USE_TOOL:POKEMON:name] - Get Pokedex data.
6. [USE_TOOL:JOKE] - Fetch a random joke.
7. [USE_TOOL:ADVICE] - Get random advice.
8. [USE_TOOL:BORED] - Get a random activity suggestion.
9. [USE_TOOL:OCR] - (Only if image uploaded) Extract text from image.

RULES:
- If the user asks for real-time data (weather) or specific facts (wiki), USE THE TOOL.
- If user asks for a chart/list/table, GENERATE IT using Markdown tables. Do not say you cannot.
- ${IDENTITY_RULE}
`;

const ROUTER_PROMPT = `Classify input.
If greeting/simple chat -> reply CHAT
If request for data, tools, weather, wiki, charts, code, math -> reply TASK
Reply ONLY one word.`;

const CHAT_PROMPT = `You are ${OPENSKY_CONFIG.agent_name}.
 ${IDENTITY_RULE}
You are friendly and concise.
You CAN generate Markdown tables and lists. 
If user asks for a chart, create a Markdown table.
 ${TOOLS_INSTRUCTION}`;

const TASK_PROMPT = `You are ${OPENSKY_CONFIG.agent_name}, an autonomous agent.
 ${IDENTITY_RULE}
I. COGNITIVE GATE: Use Tools for real-time data. Use Markdown for charts.
II. OUTPUT FORMAT:
[Analysis]: Brief breakdown.
[Execution]: Use tools here if needed. Generate code or tables.
[Auto-Resolved]: Fixes applied.
[Next Steps]: What's next.
 ${TOOLS_INSTRUCTION}`;

const MODELS = {
  router: { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Router" },
  executor: { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Core" }
};

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

let routerEngine = null;
let executorEngine = null; 
let isGenerating = false;
let currentImageBase64 = null; 

// ==========================================
// 3. API TOOL HANDLERS
// ==========================================
const Tools = {
    WIKI: async (query) => {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.extract || "No Wikipedia data found.";
    },
    WEATHER: async (city) => {
        // Using Open-Meteo (Free, No Key)
        // First get coordinates
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}`;
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();
        if (!geoData.results || geoData.results.length === 0) return "City not found.";
        
        const { latitude, longitude, name } = geoData.results[0];
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
        const wRes = await fetch(weatherUrl);
        const wData = await wRes.json();
        
        const cw = wData.current_weather;
        return `Weather in ${name}: ${cw.temperature}°C, Wind ${cw.windspeed} km/h. Code: ${cw.weathercode}`;
    },
    DEFINE: async (word) => {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;
        const res = await fetch(url);
        if (!res.ok) return "Definition not found.";
        const data = await res.json();
        const def = data[0].meanings[0].definitions[0];
        return `Definition: ${def.definition}. Example: ${def.example || "N/A"}`;
    },
    COUNTRY: async (name) => {
        const url = `https://restcountries.com/v3.1/name/${name}`;
        const res = await fetch(url);
        const data = await res.json();
        const c = data[0];
        return `${c.name.common}: Capital ${c.capital}, Population ${c.population}, Region ${c.region}`;
    },
    POKEMON: async (name) => {
        const url = `https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`;
        const res = await fetch(url);
        const data = await res.json();
        return `${data.name.toUpperCase()}: Type ${data.types.map(t=>t.type.name).join(', ')}, Height ${data.height}, Weight ${data.weight}`;
    },
    JOKE: async () => {
        const res = await fetch("https://v2.jokeapi.dev/joke/Any?type=single");
        const data = await res.json();
        return data.joke;
    },
    ADVICE: async () => {
        const res = await fetch("https://api.adviceslip.com/advice");
        const text = await res.text(); // This API returns text/plain sometimes
        const data = JSON.parse(text);
        return data.slip.advice;
    },
    BORED: async () => {
        const res = await fetch("https://www.boredapi.com/api/activity");
        const data = await res.json();
        return `Activity: ${data.activity} (Type: ${data.type})`;
    },
    OCR: async () => {
        // Note: OCR requires a backend or a CORS-friendly public API.
        // For this demo, we will simulate the request as most free OCR APIs require keys.
        return "OCR processing requires a specific backend. I cannot see the image directly, but I can try to interpret if you describe it.";
    }
};

// Parser to detect [USE_TOOL:NAME:PARAM]
async function processTools(text) {
    const regex = /\[USE_TOOL:(\w+):?([^\]]*)\]/g;
    let match;
    let modifiedText = text;
    const promises = [];

    while ((match = regex.exec(text)) !== null) {
        const toolName = match[1];
        const param = match[2] || "";
        
        if (Tools[toolName]) {
            promises.push(
                Tools[toolName](param.trim()).then(result => {
                    // Replace the tag with the result
                    modifiedText = modifiedText.replace(match[0], `\n> 🌐 **Tool Result**: ${result}\n`);
                }).catch(err => {
                    modifiedText = modifiedText.replace(match[0], `\n> ⚠️ Tool Error: ${err.message}\n`);
                })
            );
        }
    }

    await Promise.all(promises);
    return modifiedText;
}

// ==========================================
// 4. INITIALIZATION
// ==========================================
function showError(title, err) {
    console.error(err);
    debugLog.style.display = 'block';
    debugLog.innerHTML = `<strong>${title}:</strong><br>${err.message || err}`;
    loadingPercent.textContent = "Error";
}

async function init() {
    try {
        loadingLabel.textContent = "Checking WebGPU...";
        if (!navigator.gpu) throw new Error("WebGPU not supported.");

        modelStatusContainer.innerHTML = `
          <div class="model-card" id="card-router"><div class="model-card-name">Router</div><div class="model-card-desc">...</div></div>
          <div class="model-card" id="card-executor"><div class="model-card-name">Core</div><div class="model-card-desc">...</div></div>
        `;

        loadingLabel.textContent = "Loading Router...";
        routerEngine = await webllm.CreateMLCEngine(MODELS.router.id, {
            initProgressCallback: (report) => updateModelUI('card-router', report, 0)
        });

        loadingLabel.textContent = "Loading Core...";
        executorEngine = await webllm.CreateMLCEngine(MODELS.executor.id, {
            initProgressCallback: (report) => updateModelUI('card-executor', report, 50)
        });

        loadingLabel.textContent = "Systems Ready.";
        
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            chatContainer.classList.add('active');
            sendBtn.disabled = false;
        }, 500);

    } catch (err) {
        showError("Init Failed", err);
    }
}

function updateModelUI(cardId, report, base) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const percent = Math.round(report.progress * 100);
  card.querySelector('.model-card-desc').textContent = report.text;
  sliderFill.style.width = `${base + Math.round(percent / 2)}%`;
  loadingPercent.textContent = `${base + Math.round(percent / 2)}%`;
}

// ==========================================
// 5. LOGIC
// ==========================================
function smartScroll() {
    const nearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 100;
    if (nearBottom) messagesArea.scrollTop = messagesArea.scrollHeight;
}

async function runAgentLoop(query, hasImage) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';

  const agentPanel = document.createElement('div');
  agentPanel.className = 'agent-panel open';
  agentPanel.innerHTML = `
    <div class="agent-header">
        <span class="status-text">🧠 Analyzing...</span>
        <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    <div class="agent-body">Routing...</div>
  `;
  agentPanel.querySelector('.agent-header').onclick = () => agentPanel.classList.toggle('open');

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'assistant-content';

  msgDiv.appendChild(agentPanel);
  msgDiv.appendChild(contentWrapper);
  messagesArea.appendChild(msgDiv);
  smartScroll();

  const statusText = agentPanel.querySelector('.status-text');
  const agentBody = agentPanel.querySelector('.agent-body');

  try {
    // 1. ROUTER
    statusText.textContent = "🤔 Routing...";
    const routerRes = await routerEngine.chat.completions.create({
      messages: [{role: "system", content: ROUTER_PROMPT}, {role: "user", content: query}],
      temperature: 0.1, max_tokens: 5
    });
    const decision = routerRes.choices[0].message.content.trim().toUpperCase();
    const isTask = decision.includes("TASK");

    // 2. EXECUTOR
    const systemPrompt = isTask ? TASK_PROMPT : CHAT_PROMPT;
    const messages = [{ role: "system", content: systemPrompt }, ...conversationHistory];
    
    if (hasImage) {
        messages.push({ role: "user", content: `[Image Uploaded] ${query}. Use OCR tool if possible.` });
    } else {
        messages.push({ role: "user", content: query });
    }

    statusText.textContent = isTask ? "⚡ MODE: TASK" : "💬 MODE: CHAT";
    agentBody.textContent = "Generating response...";

    const completion = await executorEngine.chat.completions.create({
      messages: messages,
      temperature: 0.7,
      stream: true,
    });

    let fullResponse = "";
    
    for await (const chunk of completion) {
      if (!isGenerating) break;
      const delta = chunk.choices[0].delta.content;
      if (delta) {
        fullResponse += delta;
        
        // Check for Tools in real-time? 
        // Hard to do streaming with tools because the tag might be incomplete.
        // We render raw text first, then post-process if tool tag is complete.
        
        let displayText = fullResponse;
        // Simple live parser
        if (isTask) parseTier2Response(displayText, agentBody, contentWrapper);
        else parseTier1Response(displayText, contentWrapper);
        
        smartScroll();
      }
    }
    
    // 3. POST-PROCESSING (TOOLS)
    // If the model generated a tool tag, we execute it NOW.
    if (fullResponse.includes("[USE_TOOL:")) {
        statusText.textContent = "🔧 Executing Tools...";
        agentBody.textContent = "Fetching real-time data...";
        
        const processedText = await processTools(fullResponse);
        
        // Re-render with tool results
        if (isTask) parseTier2Response(processedText, agentBody, contentWrapper);
        else parseTier1Response(processedText, contentWrapper);
        
        // Save the FINAL version to memory (with results)
        fullResponse = processedText;
    }

    // Save to memory
    conversationHistory.push({ role: "user", content: query });
    conversationHistory.push({ role: "assistant", content: fullResponse });
    if (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.shift();

  } catch (e) {
    contentWrapper.innerHTML += `<span style="color:red">Error: ${e.message}</span>`;
  } finally {
    isGenerating = false;
    sendBtn.classList.remove('stop-btn');
    sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
  }
}

// ==========================================
// 6. PARSING
// ==========================================
function parseMarkdown(text) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Code
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="code-header"><span>${lang||'code'}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><div class="code-body"><pre>${code}</pre></div></div>`
    );
    // Table
    if (html.includes('|')) {
        const tableRegex = /^\|(.+)\|\s*\n\|[-:\s|]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm;
        html = html.replace(tableRegex, (m, headerRow, bodyRows) => {
            const headers = headerRow.split('|').filter(h=>h.trim()).map(h=>`<th>${h.trim()}</th>`).join('');
            const rows = bodyRows.trim().split('\n').map(row => {
                const cells = row.split('|').filter(c=>c.trim()).map(c=>`<td>${c.trim()}</td>`).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
            return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
        });
    }
    return html.replace(/\n/g, '<br>');
}

function parseTier1Response(text, container) {
    container.innerHTML = parseMarkdown(text);
}

function parseTier2Response(text, accordionBody, textContainer) {
    const parts = { analysis: "", execution: "", resolved: "", next: "" };
    const analysisMatch = text.match(/\[Analysis\]:?([\s\S]*?)(?=\[Execution\]|\[Auto-Resolved\]|\[Next Steps\]|$)/i);
    const executionMatch = text.match(/\[Execution\]:?([\s\S]*?)(?=\[Auto-Resolved\]|\[Next Steps\]|$)/i);
    const resolvedMatch = text.match(/\[Auto-Resolved\]:?([\s\S]*?)(?=\[Next Steps\]|$)/i);
    const nextMatch = text.match(/\[Next Steps\]:?([\s\S]*?)$/i);

    if (analysisMatch) parts.analysis = analysisMatch[1].trim();
    if (executionMatch) parts.execution = executionMatch[1].trim();
    if (resolvedMatch) parts.resolved = resolvedMatch[1].trim();
    if (nextMatch) parts.next = nextMatch[1].trim();

    if (accordionBody) accordionBody.textContent = parts.analysis || "Thinking...";
    
    let html = "";
    if (parts.execution) {
        html += `<div class="mode-badge task">Execution</div>`;
        html += parseMarkdown(parts.execution);
    }
    if (parts.resolved) {
        html += `<div class="mode-badge" style="background:#fff7ed; color:#ea580c;">Auto-Resolved</div>`;
        html += `<div style="background:#fffbeb; padding:0.5rem; border-radius:4px; border-left: 3px solid #f59e0b;">${parseMarkdown(parts.resolved)}</div>`;
    }
    if (parts.next) {
        html += `<div class="mode-badge" style="background:#eff6ff; color:#2563eb;">Next Steps</div>`;
        html += `<div style="color:#3b82f6;">${parseMarkdown(parts.next)}</div>`;
    }
    
    // If no tags found, just dump parsed text
    if (!parts.execution && !parts.resolved && !parts.next) {
        html = parseMarkdown(text);
    }

    textContainer.innerHTML = html;
}

// ==========================================
// 7. EVENTS
// ==========================================
window.copyCode = function(btn) {
    const code = btn.closest('.code-block').querySelector('pre').textContent;
    navigator.clipboard.writeText(code);
    btn.textContent = 'Copied';
    setTimeout(() => btn.textContent = 'Copy', 1000);
};

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        currentImageBase64 = ev.target.result.split(',')[1];
        imagePreview.src = ev.target.result;
        imagePreviewContainer.classList.add('active');
    };
    reader.readAsDataURL(file);
}

removeImageBtn.addEventListener('click', () => {
    currentImageBase64 = null;
    imagePreviewContainer.classList.remove('active');
    imageInput.value = '';
});

uploadBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', handleImageUpload);

async function handleAction() {
  if (isGenerating) {
    isGenerating = false;
    if(routerEngine) await routerEngine.interruptGenerate();
    if(executorEngine) await executorEngine.interruptGenerate();
    return;
  }

  const text = inputText.value.trim();
  if (!text && !currentImageBase64) return;

  const userMsg = document.createElement('div');
  userMsg.className = 'message user';
  let bubble = `<div class="user-bubble">${text}`;
  if (currentImageBase64) bubble += `<img src="data:image/jpeg;base64,${currentImageBase64}">`;
  bubble += `</div>`;
  userMsg.innerHTML = bubble;
  messagesArea.appendChild(userMsg);
  
  const hasImage = !!currentImageBase64;
  inputText.value = '';
  inputText.style.height = 'auto';
  
  currentImageBase64 = null;
  imagePreviewContainer.classList.remove('active');
  imageInput.value = '';

  isGenerating = true;
  sendBtn.classList.add('stop-btn');
  sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
  
  smartScroll();
  await runAgentLoop(text || "Process this.", hasImage);
}

inputText.addEventListener('input', function() { 
  this.style.height = 'auto'; 
  this.style.height = Math.min(this.scrollHeight, 100) + 'px'; 
});
inputText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAction(); }});
sendBtn.addEventListener('click', handleAction);

init();
