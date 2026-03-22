import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/module.min.js";

// ==========================================
// 1. CONFIGURATION (OPTIMIZED FOR MOBILE)
// ==========================================
// 8B is too big for most phones. 
// We use Qwen2.5-1.5B which is fast, smart, and fits in ~1.5GB RAM.
const OPENSKY_CONFIG = {
    "agent_name": "Opensky",
    "author": "Hafij Shaikh",
    "primary_model": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", 
    "storage_policy": "persistent_indexeddb",
    "version": "3.2.1"
};

// ==========================================
// 2. UI CONTROLLER
// ==========================================
const UI = {
    loadingScreen: document.getElementById('loadingScreen'),
    chatContainer: document.getElementById('chatContainer'),
    messagesArea: document.getElementById('messagesArea'),
    inputText: document.getElementById('inputText'),
    sendBtn: document.getElementById('sendBtn'),
    sliderFill: document.getElementById('sliderFill'),
    loadingPercent: document.getElementById('loadingPercent'),
    loadingLabel: document.getElementById('loadingLabel'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    thinkingPanel: document.getElementById('thinkingPanel'),
    thinkingContent: document.getElementById('thinkingContent'),

    setLoadingText(text) {
        if (this.loadingLabel) this.loadingLabel.textContent = text;
        console.log(`[UI] ${text}`);
    },

    showError(title, message) {
        this.setLoadingText(`❌ ${title}: ${message}`);
        if (this.loadingLabel) this.loadingLabel.style.color = "red";
        if (this.sliderFill) this.sliderFill.style.backgroundColor = "#ef4444";
        if (this.loadingPercent) this.loadingPercent.textContent = "Failed";
    },

    updateProgress(report) {
        const percent = Math.round(report.progress * 100);
        
        if (this.sliderFill) this.sliderFill.style.width = `${percent}%`;
        if (this.loadingPercent) this.loadingPercent.textContent = `${percent}%`;
        
        let friendlyText = report.text;
        if (friendlyText.includes("Fetching")) friendlyText = "Connecting to server...";
        if (friendlyText.includes("shard")) friendlyText = `Downloading AI Model... (${percent}%)`;
        
        this.setLoadingText(friendlyText);
    }
};

// ==========================================
// 3. AGENT LOGIC
// ==========================================
class Planner {
    constructor(goal) { this.goal = goal; }
    decompose() {
        if (this.goal.toLowerCase().includes("code")) return ["Analyze", "Code", "Verify"];
        return ["Understand", "Answer"];
    }
}

class Agent {
    constructor(config) {
        this.Name = config.agent_name;
        this.Author = config.author;
    }
    getSystemPrompt(plan) {
        return `You are ${this.Name}, created by ${this.Author}. Plan: ${plan.join(" -> ")}. Be concise.`;
    }
}

// ==========================================
// 4. CORE LOGIC
// ==========================================
let engine = null;
let agent = new Agent(OPENSKY_CONFIG);
let isGenerating = false;

async function initEngine() {
    try {
        UI.setLoadingText("Checking Device Compatibility...");

        // 1. CHECK WEBGPU
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported. Please use Chrome v113+ (Android/Desktop) or Edge v113+. (Note: Safari on iOS is not supported yet).");
        }

        // 2. CHECK GPU ADAPTER
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("No GPU found. This device might be too old or has hardware acceleration disabled.");
        }

        // 3. START DOWNLOAD
        UI.setLoadingText(`Initializing ${OPENSKY_CONFIG.primary_model}...`);
        
        engine = await webllm.CreateMLCEngine(
            OPENSKY_CONFIG.primary_model, 
            {
                initProgressCallback: (report) => UI.updateProgress(report)
            }
        );

        UI.setLoadingText("Model Ready!");
        finishLoading();

    } catch (e) {
        console.error(e);
        UI.showError("Initialization Failed", e.message);
    }
}

async function runAgentLoop(userQuery) {
    UI.thinkingPanel.style.display = 'block';
    UI.thinkingContent.textContent = "Thinking...";

    const planner = new Planner(userQuery);
    const plan = planner.decompose();
    UI.thinkingContent.textContent = `Plan: ${plan.join(" -> ")}`;

    try {
        const completion = await engine.chat.completions.create({
            messages: [
                { role: "system", content: agent.getSystemPrompt(plan) },
                { role: "user", content: userQuery }
            ],
            temperature: 0.7,
            stream: true,
        });

        UI.thinkingPanel.style.display = 'none';
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message sky';
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'sky-content';
        msgDiv.appendChild(contentWrapper);
        UI.messagesArea.appendChild(msgDiv);

        let fullResponse = "";
        for await (const chunk of completion) {
            const delta = chunk.choices[0].delta.content;
            if (delta) {
                fullResponse += delta;
                contentWrapper.innerHTML = parseMarkdown(fullResponse);
                UI.messagesArea.scrollTop = UI.messagesArea.scrollHeight;
            }
        }
    } catch (err) {
        UI.thinkingPanel.style.display = 'none';
        appendMessage("sky", `Error: ${err.message}`);
    } finally {
        isGenerating = false;
        setStatus('online');
    }
}

// ==========================================
// 5. HELPERS
// ==========================================
function finishLoading() {
    UI.loadingScreen.classList.add('hidden');
    UI.chatContainer.style.display = 'flex';
    UI.inputText.focus();
    setStatus('online');
}

function setStatus(status) {
    UI.sendBtn.disabled = status !== 'online';
    if (status === 'online') {
        UI.statusDot.className = 'status-dot';
        UI.statusText.className = 'status-text online';
        UI.statusText.textContent = 'Agent Ready';
    } else {
        UI.statusDot.className = 'status-dot loading';
        UI.statusText.className = 'status-text loading';
        UI.statusText.textContent = 'Processing...';
    }
}

function parseMarkdown(text) {
    if (!text) return "";
    let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    escaped = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="block-header"><span class="block-label">${lang || 'code'}</span><button class="copy-btn">Copy</button></div><div class="block-body"><pre>${code.trim()}</pre></div></div>`
    );
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
}

UI.messagesArea.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-btn')) {
        const code = e.target.closest('.code-block').querySelector('pre').textContent;
        navigator.clipboard.writeText(code);
        e.target.textContent = 'Done';
        setTimeout(() => e.target.textContent = 'Copy', 1000);
    }
});

function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user' : 'sky'}`;
    const bubble = document.createElement('div');
    bubble.className = role === 'user' ? 'user-bubble' : 'sky-content';
    bubble.innerHTML = role === 'user' ? text : parseMarkdown(text);
    div.appendChild(bubble);
    UI.messagesArea.appendChild(div);
    UI.messagesArea.scrollTop = UI.messagesArea.scrollHeight;
}

async function sendMessage() {
    const text = UI.inputText.value.trim();
    if (!text || isGenerating) return;
    
    appendMessage("user", text);
    UI.inputText.value = '';
    UI.inputText.style.height = 'auto';
    
    setStatus('generating');
    isGenerating = true;
    await runAgentLoop(text);
}

UI.inputText.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});

UI.inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

UI.sendBtn.addEventListener('click', sendMessage);

// --- START ---
initEngine();
