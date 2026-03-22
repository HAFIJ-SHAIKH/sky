import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/module.min.js";

// --- Configuration ---
const HF_REPO = "hafijshaikh/opensky";
const CONFIG_FILE = "opensky-config.json";
// Note: We assume the MLC compiled model is available or we use a base model.
// If "hafijshaikh/opensky" has MLC weights, use that ID. Otherwise fallback.
const MODEL_ID = "Llama-3.1-8B-Instruct-q4f16_1-MLC"; 

let engine = null;
let agentConfig = null;
let isGenerating = false;

// --- DOM Elements ---
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

// --- 1. Download Config from Hugging Face ---
async function loadAgentConfig() {
    updateStatusText("Downloading config from HF...");
    const url = `https://huggingface.co/${HF_REPO}/resolve/main/${CONFIG_FILE}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Config not found");
        agentConfig = await response.json();
        console.log("Agent Config Loaded:", agentConfig);
        updateStatusText("Config loaded.");
    } catch (e) {
        console.warn("Could not load opensky-config.json, using defaults.", e);
        // Default fallback config
        agentConfig = {
            system_prompt: "You are Sky, a helpful AI assistant.",
            tools: []
        };
    }
}

// --- 2. Initialize WebLLM Engine ---
async function initEngine() {
    try {
        engine = new webllm.MLCEngine();
        
        engine.setInitProgressCallback((report) => {
            const percent = Math.round(report.progress * 100);
            sliderFill.style.width = `${percent}%`;
            loadingPercent.textContent = `${percent}%`;
            loadingLabel.textContent = report.text;
        });

        // Initialize with the selected model
        await engine.reload(MODEL_ID);
        
        finishLoading();
    } catch (e) {
        loadingLabel.textContent = `Error: ${e.message}`;
        console.error(e);
    }
}

// --- 3. Agent Logic (Simulating opensky_planner.go) ---
// Since we can't run .go files, we implement the planning loop in JS.
async function runAgentPlanningLoop(userQuery) {
    showThinking(true);
    updateThinking("Analyzing request...");

    // Step 1: Construct the prompt
    // In a real scenario, we'd use the config to inject tools.
    const messages = [
        { role: "system", content: agentConfig.system_prompt || "You are a helpful agent." },
        { role: "user", content: userQuery }
    ];

    updateThinking("Generating response...");

    try {
        // Stream the response
        const completion = await engine.chat.completions.create({
            messages: messages,
            temperature: 0.7,
            stream: true,
        });

        let fullResponse = "";
        
        // Remove thinking panel once generation starts
        showThinking(false);

        // Create message container
        const skyMsg = createMessage("", false);
        messagesArea.appendChild(skyMsg);
        const contentWrapper = skyMsg.querySelector('.sky-content');

        for await (const chunk of completion) {
            const delta = chunk.choices[0].delta.content;
            if (delta) {
                fullResponse += delta;
                contentWrapper.innerHTML = parseMarkdown(fullResponse);
                messagesArea.scrollTop = messagesArea.scrollHeight;
            }
        }
        
        // If the agent needs to execute code (Advanced logic), it would happen here.
        // For now, we just display the text/code response.

    } catch (err) {
        showThinking(false);
        appendMessage("sky", `Error: ${err.message}`);
    } finally {
        isGenerating = false;
        setStatus('online');
    }
}

// --- UI Helper Functions ---

function updateStatusText(text) {
    loadingLabel.textContent = text;
}

function showThinking(show) {
    thinkingPanel.style.display = show ? 'block' : 'none';
}

function updateThinking(text) {
    thinkingContent.textContent = `[Planning]: ${text}`;
}

function finishLoading() {
    loadingScreen.classList.add('hidden');
    chatContainer.style.display = 'flex';
    inputText.focus();
    setStatus('online');
}

function setStatus(status) {
    if (status === 'online') {
        statusDot.className = 'status-dot';
        statusText.className = 'status-text online';
        statusText.textContent = 'Agent Ready';
        sendBtn.disabled = false;
    } else if (status === 'generating') {
        statusDot.className = 'status-dot loading';
        statusText.className = 'status-text loading';
        statusText.textContent = 'Processing...';
        sendBtn.disabled = true;
    }
}

function createMessage(content, isUser) {
    const div = document.createElement('div');
    div.className = `message ${isUser ? 'user' : 'sky'}`;
    
    if (isUser) {
        const bubble = document.createElement('div');
        bubble.className = 'user-bubble';
        bubble.textContent = content;
        div.appendChild(bubble);
    } else {
        const wrapper = document.createElement('div');
        wrapper.className = 'sky-content';
        wrapper.innerHTML = parseMarkdown(content);
        div.appendChild(wrapper);
    }
    
    return div;
}

function appendMessage(role, text) {
    const msg = createMessage(text, role === 'user');
    messagesArea.appendChild(msg);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function parseMarkdown(text) {
    if (!text) return "";
    let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    escaped = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'code';
        const cleanCode = code.trim();
        return `
            <div class="code-block">
                <div class="block-header">
                    <span class="block-label">${language}</span>
                    <button class="copy-btn" onclick="copyCode(this, encodeURIComponent(\`${cleanCode.replace(/`/g, '\\`')}\`))">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        <span>Copy</span>
                    </button>
                </div>
                <div class="block-body"><pre>${cleanCode}</pre></div>
            </div>`;
    });
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
}

window.copyCode = (btn, encodedText) => {
    const text = decodeURIComponent(encodedText);
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        const span = btn.querySelector('span');
        const orig = span.textContent;
        span.textContent = 'Done';
        setTimeout(() => {
            btn.classList.remove('copied');
            span.textContent = orig;
        }, 1200);
    });
};

function clearWelcome() {
    const welcome = messagesArea.querySelector('.welcome');
    if (welcome) welcome.remove();
}

// --- Main Send Logic ---

async function sendMessage() {
    const text = inputText.value.trim();
    if (!text || isGenerating) return;

    clearWelcome();
    appendMessage("user", text);
    inputText.value = '';
    inputText.style.height = 'auto';
    
    setStatus('generating');
    isGenerating = true;
    
    // Run the Agent Loop
    await runAgentPlanningLoop(text);
}

window.useSuggestion = (text) => {
    inputText.value = text;
    sendMessage();
};

// --- Event Listeners ---
inputText.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    sendBtn.disabled = !this.value.trim() || isGenerating;
});

inputText.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

// --- Initialization Sequence ---
async function init() {
    // 1. Load Config
    await loadAgentConfig();
    // 2. Load Model
    await initEngine();
}

init();
