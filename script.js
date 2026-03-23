// CORRECT URL: Changed 'module.min.js' to 'index.min.js'
import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/index.min.js";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    "agent_name": "Opensky",
    "author": "Hafij Shaikh",
    // Smaller model for better mobile/download success
    "primary_model": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", 
    "version": "3.2.2"
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

    setStatus(text, percent = null) {
        this.loadingLabel.textContent = text;
        console.log(`[Status] ${text}`);
        if (percent !== null) {
            this.loadingPercent.textContent = `${percent}%`;
            this.sliderFill.style.width = `${percent}%`;
        }
    },
    
    showError(msg) {
        this.setStatus(`❌ Error: ${msg}`, 0);
        this.loadingLabel.style.color = "red";
        this.sliderFill.style.backgroundColor = "red";
    }
};

// ==========================================
// 3. CORE LOGIC
// ==========================================
let engine = null;
let isGenerating = false;

async function initEngine() {
    try {
        UI.setStatus("Checking WebGPU Support...", 5);

        if (!navigator.gpu) {
            throw new Error("WebGPU not supported. Please use Chrome v113+ or Edge.");
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("No GPU Adapter found. Device may be unsupported.");
        }

        UI.setStatus("Initializing Engine...", 10);

        // This starts the actual download
        engine = await webllm.CreateMLCEngine(
            OPENSKY_CONFIG.primary_model, 
            {
                initProgressCallback: (report) => {
                    let percent = Math.round(report.progress * 100);
                    UI.setStatus(report.text, percent);
                }
            }
        );

        UI.setStatus("Model Loaded!", 100);
        
        // Switch screens
        setTimeout(() => {
            UI.loadingScreen.classList.add('hidden');
            UI.chatContainer.style.display = 'flex';
            UI.inputText.focus();
            setOnlineStatus(true);
        }, 500);

    } catch (e) {
        console.error(e);
        UI.showError(e.message);
    }
}

// ==========================================
// 4. AGENT & CHAT LOGIC
// ==========================================
class Planner {
    constructor(goal) { this.goal = goal; }
    decompose() {
        return this.goal.toLowerCase().includes("code") 
            ? ["Analyze", "Code", "Verify"] 
            : ["Understand", "Answer"];
    }
}

class Agent {
    constructor(config) { this.Name = config.agent_name; this.Author = config.author; }
    getSystemPrompt(plan) { return `You are ${this.Name}. Plan: ${plan.join(" -> ")}.`; }
}

const agent = new Agent(OPENSKY_CONFIG);

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
        setOnlineStatus(true);
    }
}

// ==========================================
// 5. HELPERS
// ==========================================
function setOnlineStatus(isOnline) {
    UI.sendBtn.disabled = !isOnline;
    UI.statusDot.className = isOnline ? 'status-dot' : 'status-dot loading';
    UI.statusText.textContent = isOnline ? 'Agent Ready' : 'Processing...';
    UI.statusText.className = isOnline ? 'status-text online' : 'status-text loading';
}

function parseMarkdown(text) {
    if (!text) return "";
    let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    escaped = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="block-header"><span class="block-label">${lang || 'code'}</span><button class="copy-btn">Copy</button></div><div class="block-body"><pre>${code.trim()}</pre></div></div>`
    );
    return escaped.replace(/\n/g, '<br>');
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
    
    setOnlineStatus(false);
    isGenerating = true;
    await runAgentLoop(text);
}

UI.inputText.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; });
UI.inputText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
UI.sendBtn.addEventListener('click', sendMessage);

// --- START ---
initEngine();
