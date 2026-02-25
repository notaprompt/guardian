import React, { useEffect, useRef } from 'react';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function ReflectionConversation({ conversation, highlightMessageId, onBack }) {
  const highlightRef = useRef(null);

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightMessageId]);

  if (!conversation) return null;

  const { title, created_at, messages } = conversation;
  const exchangeCount = messages ? messages.length : (conversation.message_count || 0);

  return (
    <div className="reflection-conversation">
      <div className="reflection-conversation__header">
        <button
          className="reflection-conversation__back"
          onClick={onBack}
          title="Back to results"
        >
          &larr;
        </button>
        <div className="reflection-conversation__meta">
          <div className="reflection-conversation__title">{title || 'Untitled'}</div>
          <div className="reflection-conversation__date">
            on {formatDate(created_at)} &middot; {exchangeCount} exchanges
          </div>
        </div>
      </div>
      <div className="reflection-conversation__messages">
        {(messages || []).map((msg) => {
          const isHuman = msg.sender === 'human';
          const isHighlighted = msg.id === highlightMessageId;
          return (
            <div
              key={msg.id || msg.seq}
              ref={isHighlighted ? highlightRef : null}
              className={
                'reflection-msg' +
                (isHuman ? ' reflection-msg--human' : ' reflection-msg--assistant') +
                (isHighlighted ? ' reflection-msg--highlighted' : '')
              }
            >
              <div className="reflection-msg__sender">
                {isHuman ? 'You' : 'Claude'}
              </div>
              <div className="reflection-msg__text">{msg.text}</div>
              {msg.created_at && (
                <div className="reflection-msg__time">
                  {new Date(msg.created_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
