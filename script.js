import * as webllm from "https://esm.run/@mlc-ai/webllm";

// --- Configuration ---
// "hafijshaikh/sky" requires compiled WebGPU files (.wasm, .json) in the repo.
// If missing, we fall back to a working model to ensure the UI functions.
const CUSTOM_MODEL = "hafijshaikh/sky";
const FALLBACK_MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

// --- State ---
let engine = null;
let isGenerating = false;
let chatHistory = [];

// --- DOM Elements ---
const loadingScreen = document.getElementById('loadingScreen');
const chatContainer = document.getElementById('chatContainer');
const messagesArea = document.getElementById('messagesArea');
const inputText = document.getElementById('inputText');
const sendBtn = document.getElementById('sendBtn');
const sliderFill = document.getElementById('sliderFill');
const loadingPercent = document.getElementById('loadingPercent');
const loadingLabel = document.getElementById('loadingLabel');
const errorContainer = document.getElementById('errorContainer');
const fallbackBtn = document.getElementById('fallbackBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// --- Initialization ---

async function initEngine(modelId) {
  try {
    // Reset UI state
    errorContainer.style.display = 'none';
    loadingLabel.style.color = "var(--fg-muted)";
    loadingPercent.textContent = "0%";
    sliderFill.style.width = "0%";
    sliderFill.style.background = "linear-gradient(90deg, var(--accent), var(--accent-light))";

    loadingLabel.textContent = "Checking WebGPU support...";

    // Check WebGPU
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported. Please use Chrome 113+ or Edge 113+.");
    }

    loadingLabel.textContent = `Loading ${modelId}...`;

    console.log(`Loading model: ${modelId}`);

    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        updateLoadingProgress(report);
      }
    });

    // Success
    finishLoading();

  } catch (err) {
    console.error("Model load error:", err);
    showError(err.message, modelId);
  }
}

function updateLoadingProgress(report) {
  const percent = Math.round(report.progress * 100);
  sliderFill.style.width = `${percent}%`;
  loadingPercent.textContent = `${percent}%`;
  loadingLabel.textContent = report.text;
}

function finishLoading() {
  loadingScreen.classList.add('hidden');
  chatContainer.style.display = 'flex';
  inputText.focus();
  setStatus('online');
}

function showError(message, attemptedModel) {
  loadingPercent.textContent = "Error";
  sliderFill.style.width = "100%";
  sliderFill.style.background = "#ef4444"; // Red
  
  // Specific user guidance
  if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("fetch")) {
    loadingLabel.innerHTML = `
      Could not find model files for <b>${attemptedModel}</b>.<br>
      <span style="font-size:0.7rem; color:#64748b;">
        Ensure the Hugging Face repo contains compiled WebGPU files (.wasm, mlc-chat-config.json).
      </span>
    `;
  } else {
    loadingLabel.innerHTML = message;
  }

  // Show fallback button
  errorContainer.style.display = 'block';
  document.getElementById('errorMsg').textContent = `Failed to load ${attemptedModel}`;
  
  // Fallback logic
  fallbackBtn.onclick = () => {
    console.log("Switching to fallback model...");
    initEngine(FALLBACK_MODEL);
  };
}

function setStatus(status) {
  if (status === 'online') {
    statusDot.className = 'status-dot';
    statusText.className = 'status-text online';
    statusText.textContent = 'Online';
    sendBtn.disabled = false;
  } else if (status === 'generating') {
    statusDot.className = 'status-dot loading';
    statusText.className = 'status-text loading';
    statusText.textContent = 'Generating...';
    sendBtn.disabled = true;
  }
}

// --- Chat Logic ---

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

function createTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'message sky';
  div.id = 'typingIndicator';
  const container = document.createElement('div');
  container.className = 'typing-container';
  container.innerHTML = '<div class="typing-wave"><span></span><span></span><span></span></div>';
  div.appendChild(container);
  return div;
}

// --- Markdown Parser ---

function parseMarkdown(text) {
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code Blocks
  escaped = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang || 'code';
    const cleanCode = code.trim();
    
    let styleClass = 'code-block';
    let labelClass = 'code-label';
    
    if (language === 'math') { styleClass = 'math-block'; labelClass = 'math-label'; }
    else if (language === 'gen' || language === 'creative') { styleClass = 'gen-block'; labelClass = 'gen-label'; }

    // Use encodeURIComponent to safely pass code to onclick
    const codeForAttr = encodeURIComponent(cleanCode);

    return `
      <div class="${styleClass}">
        <div class="block-header">
          <span class="block-label ${labelClass}">${language}</span>
          <button class="copy-btn" onclick="copyCode(this, '${codeForAttr}')">
             <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
             <span>Copy</span>
          </button>
        </div>
        <div class="block-body"><pre>${cleanCode}</pre></div>
      </div>`;
  });

  // Line breaks
  escaped = escaped.replace(/\n/g, '<br>');
  
  return escaped;
}

// --- Helpers ---

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

window.useSuggestion = (text) => {
  inputText.value = text;
  sendMessage();
};

// --- Main Send Logic ---

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isGenerating || !engine) return;

  clearWelcome();
  
  // Add User Message
  messagesArea.appendChild(createMessage(text, true));
  chatHistory.push({ role: "user", content: text });
  
  inputText.value = '';
  inputText.style.height = 'auto';
  
  // Show Loading State
  setStatus('generating');
  isGenerating = true;
  const typingIndicator = createTypingIndicator();
  messagesArea.appendChild(typingIndicator);
  messagesArea.scrollTop = messagesArea.scrollHeight;

  try {
    // Stream Response
    let fullResponse = "";
    
    const completion = await engine.chat.completions.create({
      messages: chatHistory,
      temperature: 0.7,
      stream: true,
    });

    // Remove typing indicator once stream starts
    typingIndicator.remove();
    
    // Create empty message container for streaming
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

    chatHistory.push({ role: "assistant", content: fullResponse });

  } catch (err) {
    console.error(err);
    typingIndicator.remove();
    const errorMsg = createMessage("Error: " + err.message, false);
    messagesArea.appendChild(errorMsg);
  } finally {
    isGenerating = false;
    setStatus('online');
  }
}

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

// --- Start ---
// Attempt to load custom model first
initEngine(CUSTOM_MODEL);
