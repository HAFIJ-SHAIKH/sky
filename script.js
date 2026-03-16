import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const db = {
    save(sessions) { localStorage.setItem('sky_sessions', JSON.stringify(sessions)); },
    load() { const data = localStorage.getItem('sky_sessions'); return data ? JSON.parse(data) : {}; }
};

const ui = {
    dom: {},
    longPressTimer: null,
    currentEditIndex: null,

    init: function() {
        this.dom = {
            list: document.getElementById('chat-list'), viewport: document.getElementById('chat-viewport'),
            input: document.getElementById('msg-input'), btn: document.getElementById('send-btn'),
            uploadBtn: document.getElementById('upload-btn'), fileInput: document.getElementById('file-input'),
            previewArea: document.getElementById('upload-preview-area'), sidebar: document.getElementById('sidebar'),
            overlay: document.getElementById('sidebar-overlay'), menuToggle: document.getElementById('menu-toggle'),
            newChatBtn: document.getElementById('new-chat-btn'), sessionList: document.getElementById('session-list'),
            
            // Loader Elements
            loaderOverlay: document.getElementById('loader-overlay'),
            loaderLog: document.getElementById('loader-log'),
            progressBar: document.getElementById('progress-bar'),
            
            dot: document.getElementById('status-dot'), text: document.getElementById('status-text'), pill: document.getElementById('status-pill'),
            contextMenu: document.getElementById('context-menu'), ctxEdit: document.getElementById('ctx-edit'), ctxCopy: document.getElementById('ctx-copy')
        };

        // Global Listeners
        document.addEventListener('click', () => this.hideContextMenu());
        window.addEventListener('resize', () => this.hideContextMenu());

        // Sidebar Listeners
        this.dom.menuToggle.addEventListener('click', () => this.toggleSidebar(true));
        this.dom.overlay.addEventListener('click', () => this.toggleSidebar(false));
        this.dom.newChatBtn.addEventListener('click', () => app.newSession());
        
        // Input Listeners
        this.dom.btn.addEventListener('click', () => app.handleSendClick());
        this.dom.uploadBtn.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
        this.dom.input.addEventListener('input', () => this.resize(this.dom.input));
        this.dom.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); app.handleSendClick(); }});
        
        // Status pill click for manual init (optional)
        this.dom.pill.addEventListener('click', () => { if(!engine.isReady) engine.init(); });

        // Context Menu Listeners
        this.dom.ctxEdit.addEventListener('click', () => { this.hideContextMenu(); app.startEdit(this.currentEditIndex); });
        this.dom.ctxCopy.addEventListener('click', () => { 
            this.hideContextMenu(); 
            const msg = app.sessions[app.currentSessionId].messages[this.currentEditIndex];
            navigator.clipboard.writeText(msg.content);
        });

        this.updateStatus(false);
    },

    toggleSidebar(show) {
        if (show) { this.dom.sidebar.classList.add('open'); this.dom.overlay.classList.add('active'); }
        else { this.dom.sidebar.classList.remove('open'); this.dom.overlay.classList.remove('active'); }
    },

    updateStatus(isReady) {
        const { dot, text } = this.dom;
        dot.className = 'status-dot';
        if (isReady) {
            dot.classList.add('online');
            text.innerText = "Sky Ready";
            text.style.color = "#0ea5e9";
        } else {
            text.innerText = "Offline";
            text.style.color = "var(--text-muted)";
        }
    },

    // Full screen loader with progress bar
    showInitLoader(show, progress = 0, text = "") {
        const { loaderOverlay, progressBar, loaderLog } = this.dom;
        if (show) {
            loaderOverlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Prevent scrolling
            progressBar.style.width = `${progress}%`;
            if(text) loaderLog.innerText = text;
        } else {
            loaderOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    },

    setGenerating(isGenerating) {
        const btn = this.dom.btn;
        if (isGenerating) {
            btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
            btn.classList.add('stop');
        } else {
            btn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
            btn.classList.remove('stop');
        }
    },

    resize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; },
    scrollToBottom() { this.dom.viewport.scrollTop = this.dom.viewport.scrollHeight; },

    handleFiles(files) {
        if (!files) return;
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/') && file.type !== 'application/pdf') return alert("Only Images/PDFs allowed");
            const reader = new FileReader();
            reader.onload = (e) => {
                app.currentFiles.push({ name: file.name, type: file.type, data: e.target.result });
                this.renderPreviews();
            };
            reader.readAsDataURL(file);
        });
        this.dom.fileInput.value = '';
    },

    renderPreviews() {
        this.dom.previewArea.innerHTML = '';
        if (app.currentFiles.length > 0) this.dom.previewArea.classList.add('active');
        else { this.dom.previewArea.classList.remove('active'); return; }

        app.currentFiles.forEach((file, i) => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            if (file.type.startsWith('image/')) div.innerHTML = `<img src="${file.data}"><button class="remove-btn" data-index="${i}"><i class="fa-solid fa-xmark"></i></button>`;
            else div.innerHTML = `<div style="text-align:center;font-size:0.7rem;color:var(--text-gray)"><i class="fa-solid fa-file-pdf"></i><br>PDF</div><button class="remove-btn" data-index="${i}"><i class="fa-solid fa-xmark"></i></button>`;
            this.dom.previewArea.appendChild(div);
        });
        this.dom.previewArea.querySelectorAll('.remove-btn').forEach(btn => btn.addEventListener('click', (e) => {
            app.currentFiles.splice(e.currentTarget.dataset.index, 1);
            this.renderPreviews();
        }));
    },

    formatText(text) {
        let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        html = html.replace(/```(\w*)\s*([\s\S]*?)```/g, (match, lang, code) => {
            return `<div class="code-container">
                <button class="copy-code-btn">Copy</button>
                <pre style="background:var(--code-bg);color:var(--code-text);padding:10px;border-radius:8px;overflow-x:auto;font-family:JetBrains Mono, monospace;font-size:0.85rem;"><code>${code}</code></pre>
            </div>`;
        });
        html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(14,165,233,0.1);color:#0ea5e9;padding:2px 4px;border-radius:4px;">$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\n/g, '<br>');
        return html;
    },

    showContextMenu(x, y, index) {
        const menu = this.dom.contextMenu;
        const msg = app.sessions[app.currentSessionId].messages[index];
        
        this.dom.ctxEdit.style.display = msg.role === 'user' ? 'flex' : 'none';
        this.currentEditIndex = index;

        menu.classList.add('active');
        
        const menuRect = menu.getBoundingClientRect();
        const finalX = (x + menuRect.width > window.innerWidth) ? x - menuRect.width : x;
        const finalY = (y + menuRect.height > window.innerHeight) ? y - menuRect.height : y;

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
    },

    hideContextMenu() {
        this.dom.contextMenu.classList.remove('active');
    },

    createMessageDOM(index, msg) {
        const row = document.createElement('div');
        row.className = `message-row ${msg.role}`;
        row.id = `msg-${index}`;

        let attachmentHTML = '';
        if (msg.files && msg.files.length > 0) {
            attachmentHTML = '<div class="attachment-preview">';
            msg.files.forEach(att => {
                if (att.type.startsWith('image')) attachmentHTML += `<img src="${att.data}">`;
                else attachmentHTML += `<div class="file-doc"><i class="fa-solid fa-file-pdf"></i> ${att.name}</div>`;
            });
            attachmentHTML += '</div>';
        }

        const textContent = msg.content ? this.formatText(msg.content) : '';
        const isLoading = (msg.role === 'sky' && !msg.content);

        if (msg.role === 'user') {
            row.innerHTML = `<div class="message-content">${attachmentHTML}<div class="text-body">${textContent}</div></div>`;
        } else {
            row.innerHTML = `<div class="message-content">${isLoading ? '<div class="loader-shifter"></div>' : textContent}</div>`;
        }

        // Interaction Listeners
        row.addEventListener('click', (e) => {
            if(e.target.closest('button')) return; 
            if(window.innerWidth > 768) {
                ui.showContextMenu(e.clientX, e.clientY, index);
            }
        });

        let timer;
        row.addEventListener('touchstart', (e) => {
            if(window.innerWidth <= 768) {
                timer = setTimeout(() => {
                    const touch = e.touches[0];
                    ui.showContextMenu(touch.clientX, touch.clientY, index);
                }, 400);
            }
        });
        row.addEventListener('touchend', () => clearTimeout(timer));
        row.addEventListener('touchmove', () => clearTimeout(timer));

        row.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const code = e.target.nextElementSibling.innerText;
                navigator.clipboard.writeText(code);
                e.target.innerText = "Copied!";
                setTimeout(() => e.target.innerText = "Copy", 1500);
            });
        });

        return row;
    },

    startEdit(index) {
        const msg = app.sessions[app.currentSessionId].messages[index];
        const row = document.getElementById(`msg-${index}`);
        const contentDiv = row.querySelector('.message-content');
        const oldHTML = contentDiv.innerHTML;

        contentDiv.innerHTML = `
            <div class="edit-container" style="width:100%;">
                <textarea class="edit-textarea" style="width:100%; border-radius:8px; border:none; padding:10px; color:#333; min-height:60px;">${msg.content}</textarea>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:5px;">
                    <button class="edit-cancel" style="background:rgba(0,0,0,0.2); color:white; border:none; padding:5px 10px; border-radius:6px;">Cancel</button>
                    <button class="edit-save" style="background:rgba(255,255,255,0.9); color:#0ea5e9; border:none; padding:5px 10px; border-radius:6px; font-weight:bold;">Save & Send</button>
                </div>
            </div>
        `;

        contentDiv.querySelector('.edit-cancel').addEventListener('click', () => {
            contentDiv.innerHTML = oldHTML;
            row.querySelectorAll('.copy-code-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const code = e.target.nextElementSibling.innerText;
                    navigator.clipboard.writeText(code);
                    e.target.innerText = "Copied!";
                    setTimeout(() => e.target.innerText = "Copy", 1500);
                });
            });
        });

        contentDiv.querySelector('.edit-save').addEventListener('click', () => {
            const newText = contentDiv.querySelector('.edit-textarea').value.trim();
            if (newText) app.saveEdit(index, newText);
        });
    },

    updateLastMessage(content) {
        const lastMsg = this.dom.list.querySelector('.message-row:last-child .message-content');
        if(lastMsg) { 
            lastMsg.innerHTML = this.formatText(content); 
            lastMsg.querySelectorAll('.copy-code-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const code = e.target.nextElementSibling.innerText;
                    navigator.clipboard.writeText(code);
                    e.target.innerText = "Copied!";
                    setTimeout(() => e.target.innerText = "Copy", 1500);
                });
            });
            this.scrollToBottom(); 
        }
    },

    renderSessions(sessions, currentId) {
        this.dom.sessionList.innerHTML = '';
        Object.keys(sessions).reverse().forEach(id => {
            const s = sessions[id];
            const div = document.createElement('div');
            div.className = `session-item ${id === currentId ? 'active' : ''}`;
            div.innerHTML = `<span>${s.title || 'New Chat'}</span><button class="session-delete" data-id="${id}"><i class="fa-solid fa-trash"></i></button>`;
            div.addEventListener('click', (e) => {
                if (e.target.closest('.session-delete')) app.deleteSession(id);
                else app.loadSession(id);
            });
            this.dom.sessionList.appendChild(div);
        });
    }
};

const engine = {
    instance: null, 
    isReady: false,
    isGenerating: false,

    async init() {
        if (this.isReady) return true;
        if (!navigator.gpu) {
            alert("WebGPU not supported. Please use Chrome/Edge.");
            return false;
        }
        
        ui.showInitLoader(true, 0, "Initializing Engine...");

        try {
            // --- MODEL CONFIGURATION ---
            // Ensure your model is hosted at hafijshaikh/sky in MLC format
            const selectedModel = "hafijshaikh/sky"; 
            // Fallback for testing if your model isn't ready:
            // const selectedModel = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

            this.instance = await webllm.CreateMLCEngine(selectedModel, {
                initProgressCallback: (report) => {
                    let progress = 0;
                    if (report.progress !== undefined) {
                        progress = Math.round(report.progress * 100);
                    }
                    ui.showInitLoader(true, progress, report.text);
                }
            });

            this.isReady = true;
            ui.updateStatus(true);
            ui.showInitLoader(false);
            return true;
            
        } catch (e) {
            console.error(e);
            ui.showInitLoader(true, 0, "Error: " + e.message);
            // Keep error visible for a few seconds
            await new Promise(r => setTimeout(r, 3000));
            ui.showInitLoader(false);
            return false;
        }
    },

    async generate(history, files) {
        if (!this.isReady) return "System offline.";
        
        let content = [];
        files.forEach(f => {
            if (f.type.startsWith('image')) content.push({ type: "image_url", image_url: { url: f.data } });
            else content.push({ type: "text", text: `[File: ${f.name}]` });
        });

        const last = history[history.length - 1];
        if (last.role === 'user') {
            if (files.length > 0) {
                content.push({ type: "text", text: last.content });
                last.content = content;
            }
        }

        this.isGenerating = true;
        ui.setGenerating(true);
        let fullResponse = "";

        try {
            const asyncChunkGenerator = await this.instance.chat.completions.create({
                messages: history,
                temperature: 0.7,
                max_tokens: 4096,
                stream: true
            });

            for await (const chunk of asyncChunkGenerator) {
                if (!this.isGenerating) break;
                const delta = chunk.choices[0]?.delta?.content || "";
                fullResponse += delta;
                ui.updateLastMessage(fullResponse);
            }
        } catch (e) { 
            fullResponse += "\n[Error: " + e.message + "]"; 
        }
        
        this.isGenerating = false;
        ui.setGenerating(false);
        return fullResponse;
    },

    stop() {
        this.isGenerating = false;
        ui.updateLastMessage(ui.dom.list.querySelector('.message-row:last-child .message-content').innerText + " [Stopped]");
    }
};

const app = {
    sessions: {}, currentSessionId: null, currentFiles: [],

    init() {
        ui.init();
        this.sessions = db.load();
        if (Object.keys(this.sessions).length === 0) this.newSession();
        else this.loadSession(Object.keys(this.sessions).pop());
    },

    newSession() {
        const id = Date.now().toString();
        this.sessions[id] = { title: "New Chat", messages: [], created: id };
        this.save();
        this.loadSession(id);
    },

    loadSession(id) {
        this.currentSessionId = id;
        const session = this.sessions[id];
        
        ui.dom.list.innerHTML = '';
        session.messages.forEach((msg, index) => {
            ui.dom.list.appendChild(ui.createMessageDOM(index, msg));
        });
        
        ui.renderSessions(this.sessions, id);
        ui.toggleSidebar(false);
        ui.scrollToBottom();
    },

    deleteSession(id) {
        delete this.sessions[id];
        this.save();
        if (this.currentSessionId === id) {
            const keys = Object.keys(this.sessions);
            keys.length > 0 ? this.loadSession(keys[0]) : this.newSession();
        } else ui.renderSessions(this.sessions, this.currentSessionId);
    },

    save() { db.save(this.sessions); ui.renderSessions(this.sessions, this.currentSessionId); },

    async handleSendClick() {
        if(engine.isGenerating) {
            engine.stop();
        } else {
            await this.send();
        }
    },

    async saveEdit(index, newText) {
        const session = this.sessions[this.currentSessionId];
        session.messages[index].content = newText;
        session.messages = session.messages.slice(0, index + 1);

        ui.dom.list.innerHTML = '';
        session.messages.forEach((msg, i) => ui.dom.list.appendChild(ui.createMessageDOM(i, msg)));
        this.save();
        
        ui.dom.list.appendChild(ui.createMessageDOM(session.messages.length, { role: 'sky', content: '' }));
        
        // Check if engine needs init before edit
        if (!engine.isReady) {
            const success = await engine.init();
            if (!success) return;
        }

        engine.generate(session.messages, session.messages[index].files || []).then(reply => {
            session.messages.push({ role: 'assistant', content: reply });
            this.save();
        });
    },

    async send() {
        const text = ui.dom.input.value.trim();
        const files = [...this.currentFiles];
        if (!text && files.length === 0) return;
        
        // INIT CHECK: This triggers the download overlay if not ready
        if (!engine.isReady) {
            const success = await engine.init();
            if (!success) return; // Stop if init failed
        }

        const session = this.sessions[this.currentSessionId];
        const msgIndex = session.messages.length;
        const msg = { role: 'user', content: text, files: files };
        session.messages.push(msg);
        
        ui.dom.list.appendChild(ui.createMessageDOM(msgIndex, msg));
        
        ui.dom.input.value = ''; ui.dom.input.style.height = 'auto';
        ui.dom.previewArea.innerHTML = ''; ui.dom.previewArea.classList.remove('active');
        this.currentFiles = [];
        ui.scrollToBottom();

        if (session.messages.length === 1) { session.title = text.substring(0, 20); this.save(); }

        ui.dom.list.appendChild(ui.createMessageDOM(msgIndex + 1, { role: 'sky', content: '' }));
        
        const reply = await engine.generate(session.messages, files);
        
        session.messages.push({ role: 'assistant', content: reply });
        this.save();
    }
};

window.addEventListener('DOMContentLoaded', () => app.init());
