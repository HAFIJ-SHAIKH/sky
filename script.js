// FIX: Using the generic ESM entry point prevents 404 errors
import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/+esm";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    "agent_name": "Opensky",
    "author": "Hafij Shaikh",
    // Using a smaller, high-quality model for reliability
    "primary_model": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", 
    "version": "3.5.0"
};

// ==========================================
// 2. UI CONTROLLER
// ==========================================
const UI = {
    // Elements
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

    // State
    isOnline: false,

    // Update Main Loading Status
    setStatus(text, percent = null) {
        if (this.loadingLabel) this.loadingLabel.textContent = text;
        console.log(`[System] ${text}`);
        if (percent !== null) {
            if (this.loadingPercent) this.loadingPercent.textContent = `${percent}%`;
            if (this.sliderFill) this.sliderFill.style.width = `${percent}%`;
        }
    },

    // Show Critical Error (Better UI)
    showCriticalError(title, message) {
        this.loadingLabel.innerHTML = `
            <div style="text-align: center; color: #ef4444;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
                <div style="font-weight: 700; margin-bottom: 0.25rem;">${title}</div>
                <div style="font-size: 0.75rem; color: #64748b;">${message}</div>
                <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Retry Boot Sequence
                </button>
            </div>
        `;
        this.loadingPercent.textContent = "HALT";
        this.sliderFill.style.backgroundColor = "#ef4444";
    },

    // Thinking Panel
    think(text) {
        if (this.thinkingPanel) this.thinkingPanel.style.display = 'block';
        if (this.thinkingContent) this.thinkingContent.textContent = text;
    },
    hideThink() {
        if (this.thinkingPanel) this.thinkingPanel.style.display = 'none';
    }
};

// ==========================================
// 3. AUTONOMOUS AGENT BRAIN
// ==========================================
class AutonomousAgent {
    constructor(config) {
        this.name = config.agent_name;
        this.author = config.author;
        this.personality = "Analytical, Precise, Autonomous";
    }

    // The Brain Loop: Plan -> Critique -> Execute
    getSystemPrompt(userQuery) {
        // This prompt forces the AI to 'think' before it speaks
        return `You are ${this.name}, an autonomous AI agent created by ${this.author}.
Your operational mode is: '${this.personality}'.

When responding, follow this internal protocol:
1. ANALYZE: Determine the core intent of the user's request.
2. PLAN: Outline the steps needed to answer.
3. EXECUTE: Generate the final response based on the plan.

Current User Request: "${userQuery}"

Begin your internal reasoning process now.`;
    }
}

const agent = new AutonomousAgent(OPENSKY_CONFIG);
let engine = null;
let isGenerating = false;

// ==========================================
// 4. INITIALIZATION ENGINE
// ==========================================
async function initEngine() {
    try {
        UI.setStatus("Connecting to Neural Network...", 5);

        // WebGPU Check
        if (!navigator.gpu) {
            throw new Error("WebGPU Unavailable");
        }
        
        UI.setStatus("Initializing Core Systems...", 10);
        
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("GPU Adapter Null");

        UI.setStatus("Downloading Intelligence Module...", 15);

        // Create Engine with Download Progress
        engine = await webllm.CreateMLCEngine(
            OPENSKY_CONFIG.primary_model, 
            {
                initProgressCallback: (report) => {
                    let percent = Math.round(report.progress * 100);
                    UI.setStatus(report.text, percent);
                }
            }
        );

        UI.setStatus("Boot Sequence Complete.", 100);
        
        setTimeout(() => {
            UI.loadingScreen.classList.add('hidden');
            UI.chatContainer.style.display = 'flex';
            UI.inputText.focus();
            setOnlineStatus(true);
        }, 500);

    } catch (e) {
        console.error(e);
        // Friendly Error Handling
        if (e.message.includes("WebGPU")) {
             UI.showCriticalError("Incompatible Hardware", "Your browser or device does not support WebGPU. Try Chrome v113+.");
        } else if (e.message.includes("fetch")) {
             UI.showCriticalError("Network Failure", "Could not download AI model. Check your internet connection.");
        } else {
             UI.showCriticalError("System Failure", e.message);
        }
    }
}

// ==========================================
// 5. CHAT LOGIC
// ==========================================
async function runAgentLoop(userQuery) {
    UI.think("🧠 Initializing Cognitive Cycle...");
    
    // Simulate Autonomous Thinking Steps
    await sleep(300);
    UI.think("🔬 Step 1: Analyzing semantic intent...");
    await sleep(400);
    UI.think("📝 Step 2: Formulating reasoning chain...");
    
    try {
        const completion = await engine.chat.completions.create({
            messages: [
                { role: "system", content: agent.getSystemPrompt(userQuery) },
                { role: "user", content: userQuery }
            ],
            temperature: 0.7,
            stream: true,
        });

        UI.think("✅ Step 3: Generating output stream...");
        
        // Small delay to show the "Step 3" before text appears
        await sleep(500);
        UI.hideThink();

        // Create Message Bubble
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
        UI.hideThink();
        appendMessage("sky", `⚠️ **System Warning:** ${err.message}`);
    } finally {
        isGenerating = false;
        setOnlineStatus(true);
    }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ==========================================
// 6. UI HELPERS & EVENTS
// ==========================================
function setOnlineStatus(isOnline) {
    UI.isOnline = isOnline;
    UI.sendBtn.disabled = !isOnline;
    UI.statusDot.className = isOnline ? 'status-dot' : 'status-dot loading';
    UI.statusText.textContent = isOnline ? 'Autonomous Mode' : 'Processing...';
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

// --- BOOT SEQUENCE ---
initEngine();
