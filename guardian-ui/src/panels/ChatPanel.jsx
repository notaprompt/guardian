import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import PanelHeader from '../components/PanelHeader';
import TokenUsage from '../components/TokenUsage';
import ThinkingIndicator from '../components/ThinkingIndicator';
import AwarenessAlert from '../components/AwarenessAlert';
import SessionContext from '../components/SessionContext';
import FirstSessionGuide from '../components/FirstSessionGuide';
import useStore from '../store';

function ChatPanelInner() {
  const [input, setInput] = useState('');
  const [sessionStatus, setSessionStatus] = useState('ready');
  const [showUsage, setShowUsage] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [chatError, setChatError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const accumulatorRef = useRef('');
  const thinkingAccRef = useRef('');
  const currentMsgIdRef = useRef(null);
  const blockTypeMapRef = useRef({});

  const messages = useStore((s) => s.chatMessages);
  const addMessage = useStore((s) => s.addChatMessage);
  const updateLastAssistant = useStore((s) => s.updateLastAssistantMessage);
  const clearChat = useStore((s) => s.clearChat);
  const chatIsResponding = useStore((s) => s.chatIsResponding);
  const setChatIsResponding = useStore((s) => s.setChatIsResponding);
  const setUsageRecords = useStore((s) => s.setUsageRecords);
  const addUsageRecord = useStore((s) => s.addUsageRecord);
  const thinkingBlocks = useStore((s) => s.thinkingBlocks);
  const setThinkingForMessage = useStore((s) => s.setThinkingForMessage);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const setActiveSessionId = useStore((s) => s.setActiveSessionId);
  const fetchSessions = useStore((s) => s.fetchSessions);
  const setAwareness = useStore((s) => s.setAwareness);
  const sessions = useStore((s) => s.sessions);
  const profile = useStore((s) => s.profile);
  const firstRunComplete = useStore((s) => s.firstRunComplete);
  const initWelcome = useStore((s) => s.initWelcome);
  const librarianStatus = useStore((s) => s.librarianStatus);
  const initLibrarian = useStore((s) => s.initLibrarian);
  const pipelineDigest = useStore((s) => s.pipelineDigest);
  const clearPipelineDigest = useStore((s) => s.clearPipelineDigest);
  const navigateTo = useStore((s) => s.navigateTo);
  const quietMode = useStore((s) => s.quietMode);
  const buildSessionContext = useStore((s) => s.buildSessionContext);

  // ── First-run welcome (Spec VI Step 4) ─────────────────────
  // Detect: onboarding complete + no sessions exist + haven't done this yet
  const welcomeTriggered = useRef(false);
  useEffect(() => {
    if (
      profile?.onboardingComplete &&
      sessions.length === 0 &&
      messages.length === 0 &&
      !firstRunComplete &&
      !welcomeTriggered.current
    ) {
      welcomeTriggered.current = true;
      addMessage('system', 'Guardian is ready. Everything here persists \u2014 your conversations, your notes, your artifacts. Nothing is lost. Type anything.');
      initWelcome();
    }
  }, [profile, sessions, messages.length, firstRunComplete, addMessage, initWelcome]);

  // Build session context on empty session
  useEffect(() => {
    if (!activeSessionId && messages.length === 0) {
      buildSessionContext();
    }
  }, [activeSessionId, messages.length, buildSessionContext]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingBlocks]);

  // Load saved usage records on mount
  useEffect(() => {
    window.guardian?.usage.load().then((res) => {
      if (res?.ok && res.records) {
        setUsageRecords(res.records);
      }
    });
  }, [setUsageRecords]);

  // Initialize librarian status listener on mount
  useEffect(() => {
    initLibrarian();
  }, [initLibrarian]);

  // Auto-dismiss librarian "complete" status after 5 seconds
  const setLibrarianStatus = useStore((s) => s.setLibrarianStatus);
  useEffect(() => {
    if (librarianStatus?.status === 'complete') {
      const timer = setTimeout(() => setLibrarianStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [librarianStatus, setLibrarianStatus]);

  // Listen for stream-json events from main process
  useEffect(() => {
    const unsubEvent = window.guardian?.chat.onEvent((event) => {
      // Clear error on new events
      setChatError(null);

      // Register block type when a content block starts
      if (event.type === 'content_block_start' && event.content_block) {
        blockTypeMapRef.current[event.index] = event.content_block.type;
      }

      // Handle thinking deltas
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'thinking_delta'
      ) {
        thinkingAccRef.current += event.delta.thinking;
        if (currentMsgIdRef.current) {
          setThinkingForMessage(currentMsgIdRef.current, thinkingAccRef.current, false);
        }
      }

      // Handle text deltas (ignore signature_delta)
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta'
      ) {
        accumulatorRef.current += event.delta.text;
        updateLastAssistant(accumulatorRef.current);
      }

      // content_block_stop — mark thinking complete for that block
      if (event.type === 'content_block_stop') {
        const blockType = blockTypeMapRef.current[event.index];
        if (blockType === 'thinking' && currentMsgIdRef.current) {
          setThinkingForMessage(currentMsgIdRef.current, thinkingAccRef.current, true);
        }
      }

      // Claude CLI stream-json: "assistant" event has full message
      if (event.type === 'assistant' && event.message?.content) {
        const textParts = [];
        for (const block of event.message.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          }
          if (block.type === 'thinking' && block.thinking && currentMsgIdRef.current) {
            thinkingAccRef.current = block.thinking;
            setThinkingForMessage(currentMsgIdRef.current, block.thinking, true);
          }
        }
        const text = textParts.join('');
        if (text) {
          accumulatorRef.current = text;
          updateLastAssistant(text);
        }
      }

      // Capture token usage from result events
      if (event.type === 'result') {
        const usage = event.usage || event.message?.usage;
        if (usage) {
          const record = {
            timestamp: new Date().toISOString(),
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
          };
          addUsageRecord(record);
          window.guardian?.usage.append(record);
        }
      }
    });

    const unsubError = window.guardian?.chat.onError(({ error, type }) => {
      if (error && error.trim()) {
        setChatError({ message: error.trim(), type: type || 'unknown' });
      }
    });

    const unsubDone = window.guardian?.chat.onDone(({ sessionId }) => {
      // Mark thinking complete on done
      if (currentMsgIdRef.current && thinkingAccRef.current) {
        setThinkingForMessage(currentMsgIdRef.current, thinkingAccRef.current, true);
      }
      setChatIsResponding(false);
      accumulatorRef.current = '';
      thinkingAccRef.current = '';
      blockTypeMapRef.current = {};
      // Refresh session list
      fetchSessions();
    });

    const unsubSession = window.guardian?.chat.onSessionCreated(({ sessionId }) => {
      setActiveSessionId(sessionId);
    });

    // Listen for awareness-trap detections
    const unsubAwareness = window.guardian?.awareness?.onDetected((detection) => {
      if (detection) setAwareness(detection);
    });

    return () => {
      unsubEvent?.();
      unsubError?.();
      unsubDone?.();
      unsubSession?.();
      unsubAwareness?.();
    };
  }, [updateLastAssistant, addMessage, setChatIsResponding, addUsageRecord, setThinkingForMessage, setActiveSessionId, fetchSessions, setAwareness]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || chatIsResponding) return;

    setChatError(null);
    addMessage('user', text);
    const msgId = addMessage('assistant', '');
    currentMsgIdRef.current = msgId;
    setInput('');
    accumulatorRef.current = '';
    thinkingAccRef.current = '';
    blockTypeMapRef.current = {};
    setChatIsResponding(true);

    // Build attachment data for IPC
    const attachmentData = attachments.map((a) => ({
      name: a.name,
      type: a.type,
      data: a.data,
      isImage: a.isImage,
    }));
    setAttachments([]);

    await window.guardian?.chat.send(text, attachmentData.length > 0 ? attachmentData : undefined);
  }, [input, chatIsResponding, addMessage, setChatIsResponding, attachments]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleNewSession = useCallback(async () => {
    setChatIsResponding(false);
    await window.guardian?.chat.stop();
    await window.guardian?.chat.newSession();
    clearChat();
    accumulatorRef.current = '';
    thinkingAccRef.current = '';
    blockTypeMapRef.current = {};
    currentMsgIdRef.current = null;
    setChatError(null);
    setSessionStatus('ready');
    fetchSessions();
    buildSessionContext();
  }, [clearChat, setChatIsResponding, fetchSessions, buildSessionContext]);

  const handleStop = useCallback(async () => {
    await window.guardian?.chat.stop();
    setChatIsResponding(false);
  }, [setChatIsResponding]);

  // File attachment via dialog
  const handleAttach = useCallback(async () => {
    const result = await window.guardian?.file?.open();
    if (result?.files) {
      setAttachments((prev) => [...prev, ...result.files]);
    }
  }, []);

  // Remove an attachment
  const handleRemoveAttachment = useCallback((index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Paste handler for images
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          setAttachments((prev) => [...prev, {
            name: `pasted-image-${Date.now()}.png`,
            type: item.type,
            data: base64,
            isImage: true,
            preview: reader.result,
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  return (
    <>
      <PanelHeader
        label="Chat"
        active={sessionStatus === 'ready'}
        status={sessionStatus === 'ready' ? 'active' : 'idle'}
      >
        <div className="session-picker">
          {activeSessionId && (
            <span className="session-picker__btn session-picker__btn--active" title={activeSessionId}>
              session
            </span>
          )}
        </div>
        <button
          className={`zone-head__btn${showUsage ? ' zone-head__btn--active' : ''}`}
          onClick={() => setShowUsage((v) => !v)}
          title="Token usage"
          aria-label="Toggle token usage display"
          aria-pressed={showUsage}
        >
          &#9672;
        </button>
        {chatIsResponding && (
          <button
            className="zone-head__btn"
            onClick={handleStop}
            title="Stop responding"
            aria-label="Stop Claude from responding"
          >
            &#9632;
          </button>
        )}
        <button
          className="zone-head__btn"
          onClick={handleNewSession}
          title="New session"
          aria-label="Start new chat session"
        >
          +
        </button>
      </PanelHeader>

      {showUsage && <TokenUsage />}

      <AwarenessAlert />
      <SessionContext />

      <div className="chat-messages" style={{ flex: 1, minHeight: 0 }} role="log" aria-label="Chat messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="empty-state" role="status">
            <div className="empty-state__icon" aria-hidden="true">&#9672;</div>
            <div className="empty-state__text">No messages yet</div>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}`}
            aria-label={`${msg.role} message`}
          >
            {msg.role === 'assistant' && thinkingBlocks[msg.id] && (
              <ThinkingIndicator
                thinking={thinkingBlocks[msg.id].text}
                isStreaming={!thinkingBlocks[msg.id].isComplete}
              />
            )}
            {msg.role === 'assistant' && !msg.content && chatIsResponding && !thinkingBlocks[msg.id] && (
              <span className="chat-thinking" role="status" aria-live="polite">Thinking...</span>
            )}
            <div className="chat-message__content">
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {msg.content}
                </Markdown>
              )}
            </div>
          </div>
        ))}

        {/* Classified error display */}
        {chatError && (
          <div className="chat-error" role="alert" aria-live="assertive">
            {chatError.type !== 'unknown' && (
              <div className="chat-error__type">{chatError.type}</div>
            )}
            {chatError.message}
          </div>
        )}

        {/* Pipeline digest card */}
        {pipelineDigest && !quietMode && (
          <div className="chat-digest" role="status" aria-live="polite">
            <div className="chat-digest__header">
              Guardian learned
              <button className="chat-digest__dismiss" onClick={clearPipelineDigest} aria-label="Dismiss digest">x</button>
            </div>
            <div className="chat-digest__items">
              {pipelineDigest.summarized && <span>summarized</span>}
              {pipelineDigest.entities > 0 && (
                <span className="chat-digest__item--link" onClick={() => navigateTo('graph')}>
                  {pipelineDigest.entities} entities
                </span>
              )}
              {pipelineDigest.relationships > 0 && (
                <span className="chat-digest__item--link" onClick={() => navigateTo('graph')}>
                  {pipelineDigest.relationships} relationships
                </span>
              )}
              {pipelineDigest.embeddingChunks > 0 && (
                <span className="chat-digest__item--link" onClick={() => navigateTo('search')}>
                  {pipelineDigest.embeddingChunks} chunks indexed
                </span>
              )}
              {pipelineDigest.notesCreated > 0 && (
                <span className="chat-digest__item--link" onClick={() => navigateTo('notes')}>
                  {pipelineDigest.notesCreated} notes created
                </span>
              )}
              {pipelineDigest.artifactsFiled > 0 && (
                <span className="chat-digest__item--link" onClick={() => navigateTo('notes')}>
                  {pipelineDigest.artifactsFiled} artifacts filed
                </span>
              )}
              {pipelineDigest.awareness && (
                <span className="chat-digest__item--link chat-digest__item--awareness">
                  awareness pattern detected
                </span>
              )}
            </div>
          </div>
        )}

        <FirstSessionGuide />

        {/* Librarian extraction status */}
        {librarianStatus && (
          <div
            className={`chat-librarian-status chat-librarian-status--${librarianStatus.status}`}
            role="status"
            aria-live="polite"
          >
            {librarianStatus.status === 'extracting' && 'Extracting insights...'}
            {librarianStatus.status === 'complete' && (
              <>Created {librarianStatus.notesCreated || 0} notes, filed {librarianStatus.artifactsFiled || 0} artifacts</>
            )}
            {librarianStatus.status === 'failed' && 'Extraction failed'}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachment preview strip */}
      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map((att, i) => (
            <div key={i} className="chat-attachment">
              {att.isImage || att.type?.startsWith('image/') ? (
                <img
                  className="chat-attachment__thumb"
                  src={att.preview || `data:${att.type};base64,${att.data}`}
                  alt={att.name}
                />
              ) : (
                <span className="chat-attachment__icon">doc</span>
              )}
              <span className="chat-attachment__name">{att.name}</span>
              <button
                className="chat-attachment__remove"
                onClick={() => handleRemoveAttachment(i)}
                title="Remove"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-area" role="form" aria-label="Send a message">
        <button
          className="chat-attach-btn"
          onClick={handleAttach}
          title="Attach file"
          aria-label="Attach file"
          disabled={chatIsResponding}
        >
          +
        </button>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            chatIsResponding ? 'Claude is responding...'
            : 'Send a message... (Shift+Enter for newline)'
          }
          rows={1}
          disabled={chatIsResponding}
          aria-label="Message input"
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || chatIsResponding}
          aria-label={chatIsResponding ? 'Responding' : 'Send message'}
        >
          {chatIsResponding ? '...' : 'Send'}
        </button>
      </div>
    </>
  );
}

export default React.memo(ChatPanelInner);
