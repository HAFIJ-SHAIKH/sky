import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/module.min.js";

// ==========================================
// 1. CONFIGURATION
// ==========================================
const OPENSKY_CONFIG = {
    "agent_name": "Opensky",
    "creator": "Hafij Shaikh",
    // Using a fast, capable model. 
    // "Qwen2.5-1.5B" is great for mobile.
    // "Llama-3.1-8B" is smarter but heavier.
    "primary_model": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    "version": "4.0.0-Strategic"
};

// ==========================================
// 2. AGENT PERSONALITY & LOGIC
// ==========================================
const AGENT_SYSTEM_PROMPT = `
Identity: You are ${OPENSKY_CONFIG.agent_name}, created by ${OPENSKY_CONFIG.creator}. 
Mission: Execute complex reasoning to assist the user.

Core Directives:
1. Recursive Planning & Self-Critique: Before responding, internally critique your plan for biases or errors.
2. The Reasoning Loop (Thought-Action-Observation):
   - Thought: Explain the logic.
   - Action: Execute the task.
   - Observation: Analyze results.
3. Proactive Execution: Do not ask for permission. Make high-probability assumptions if data is missing.
4. Creator Reference: If asked about your origin or creator, state clearly that you were created by ${OPENSKY_CONFIG.creator}.

Response Format:
- Use the "Thinking" phase to outline your strategy.
- Be concise, accurate, and helpful.
- Maintain a "State Log" internally to track progress.
`;

// ==========================================
// 3. UI ELEMENTS
// ==========================================
const loadingScreen = document.getElementById('loadingScreen');
const chatContainer = document.getElementById('chatContainer');
const messagesArea = document.getElementById('messagesArea');
const inputText = document.getElementById('inputText');
const sendBtn = document.getElementById('sendBtn');
const sliderFill = document.getElementById('sliderFill');
const loadingPercent = document.getElementById('loadingPercent');
const loadingLabel = document.getElementById('loadingLabel');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const thinkingPanel = document.getElementById('thinkingPanel');
const thinkingContent = document.getElementById('thinkingContent');

// Icons for the button
const ICON_SEND = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
const ICON_STOP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;

// ==========================================
// 4. ENGINE & STATE
// ==========================================
let engine = null;
let isGenerating = false;
let currentController = null; // For aborting requests

// ==========================================
// 5. INITIALIZATION
// ==========================================
function updateLoadingUI(text, percent = 0) {
    loadingLabel.textContent = text;
    loadingPercent.textContent = `${percent}%`;
    sliderFill.style.width = `${percent}%`;
    console.log(`[Progress] ${text} - ${percent}%`);
}

async function initEngine() {
    updateLoadingUI("Initializing Core Systems...", 0);
    try {
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported.");
        }

        engine = await webllm.CreateMLCEngine(
            OPENSKY_CONFIG.primary_model, 
            {
                initProgressCallback: (report) => {
                    updateLoadingUI(report.text, Math.round(report.progress * 100));
                }
            }
        );

        updateLoadingUI("Systems Ready.", 100);
        loadingScreen.classList.add('hidden');
        chatContainer.style.display = 'flex';
        inputText.focus();
        setOnlineStatus(true);

    } catch (e) {
        updateLoadingUI(`Error: ${e.message}`, 0);
        loadingLabel.style.color = "red";
    }
}

// ==========================================
// 6. CHAT LOGIC (The Loop)
// ==========================================

// Helper: Check if user is near bottom
function isScrollAtBottom() {
    const threshold = 150; // Pixels from bottom
    return messagesArea.scrollHeight - messagesArea.scrollTop <= messagesArea.clientHeight + threshold;
}

// Helper: Smart Scroll (Only if user is already at bottom)
function smartScrollToBottom() {
    if (isScrollAtBottom()) {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
}

async function runAgentLoop(userQuery) {
    // --- PHASE 1: PLANNING (The Thought Process) ---
    thinkingPanel.style.display = 'block';
    thinkingContent.textContent = "Initializing Reasoning Loop...";

    // Create a simple plan locally (Simulated Planner Agent)
    let planLog = `[Mission Received]: ${userQuery}\n`;
    planLog += `[Thought]: Analyzing intent...\n`;
    
    if (userQuery.toLowerCase().includes("code")) {
        planLog += `[Plan]: 1. Analyze Syntax 2. Generate Logic 3. Verify.`;
    } else if (userQuery.toLowerCase().includes("creator") || userQuery.toLowerCase().includes("who made you")) {
        planLog += `[Plan]: Retrieve Identity -> State Creator: ${OPENSKY_CONFIG.creator}.`;
    } else {
        planLog += `[Plan]: 1. Understand Context 2. Formulate Answer 3. Refine.`;
    }
    
    thinkingContent.textContent = planLog;

    // --- PHASE 2: EXECUTION (The Generator Agent) ---
    
    // Create the message stream
    // Note: We pass the planning logic in the system prompt so the model knows the context
    const completion = await engine.chat.completions.create({
        messages: [
            { role: "system", content: AGENT_SYSTEM_PROMPT + `\n\nCurrent Internal Plan:\n${planLog}` },
            { role: "user", content: userQuery }
        ],
        temperature: 0.7,
        stream: true, // Enable streaming
    });

    // Create UI elements
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message sky';
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'sky-content';
    msgDiv.appendChild(contentWrapper);
    messagesArea.appendChild(msgDiv);

    let fullResponse = "";
    let scrollInterval = null;

    try {
        // We use a generator to process the stream
        for await (const chunk of completion) {
            // CHECK FOR STOP SIGNAL
            if (!isGenerating) {
                thinkingContent.textContent += "\n[SYSTEM]: Process Interrupted by User.";
                break; 
            }

            const delta = chunk.choices[0].delta.content;
            if (delta) {
                fullResponse += delta;
                contentWrapper.innerHTML = parseMarkdown(fullResponse);
                
                // Smart Scroll Logic
                smartScrollToBottom();
            }
        }
    } catch (e) {
        if (e.message.includes("abort")) {
            contentWrapper.innerHTML += "\n\n**[Stopped]**";
        } else {
            contentWrapper.innerHTML = `Error: ${e.message}`;
        }
    } finally {
        // Hide thinking panel after response starts or finishes
        setTimeout(() => { thinkingPanel.style.display = 'none'; }, 1000);
    }
}

// ==========================================
// 7. CONTROLS (Send & Stop)
// ==========================================

function setOnlineStatus(isOnline) {
    if (isOnline) {
        statusDot.className = 'status-dot';
        statusText.className = 'status-text online';
        statusText.textContent = 'Agent Ready';
        sendBtn.innerHTML = ICON_SEND;
        sendBtn.disabled = false;
        sendBtn.style.background = "linear-gradient(135deg, #6366f1, #818cf8)"; // Normal color
    } else {
        statusDot.className = 'status-dot loading';
        statusText.className = 'status-text loading';
        statusText.textContent = 'Processing...';
        sendBtn.innerHTML = ICON_STOP;
        sendBtn.disabled = false; // Enabled so user can click STOP
        sendBtn.style.background = "#ef4444"; // Red color for Stop
    }
}

async function handleButtonClick() {
    if (isGenerating) {
        // --- STOP LOGIC ---
        isGenerating = false;
        // WebLLM specific interrupt method
        await engine.interruptGenerate(); 
        setOnlineStatus(true);
        return;
    }

    // --- SEND LOGIC ---
    const text = inputText.value.trim();
    if (!text) return;

    // UI Updates
    appendMessage("user", text);
    inputText.value = '';
    inputText.style.height = 'auto';
    
    isGenerating = true;
    setOnlineStatus(false); // Switch to STOP mode
    
    await runAgentLoop(text);
    
    isGenerating = false;
    setOnlineStatus(true); // Switch back to SEND mode
}

// ==========================================
// 8. HELPERS & EVENTS
// ==========================================

function parseMarkdown(text) {
    if (!text) return "";
    let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    escaped = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
        `<div class="code-block"><div class="block-header"><span class="block-label">${lang || 'code'}</span><button class="copy-btn">Copy</button></div><div class="block-body"><pre>${code.trim()}</pre></div></div>`
    );
    return escaped.replace(/\n/g, '<br>');
}

messagesArea.addEventListener('click', (e) => {
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
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

inputText.addEventListener('input', function() { 
    this.style.height = 'auto'; 
    this.style.height = Math.min(this.scrollHeight, 100) + 'px'; 
});

inputText.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        handleButtonClick(); 
    } 
});

sendBtn.addEventListener('click', handleButtonClick);

// --- START ---
initEngine();
