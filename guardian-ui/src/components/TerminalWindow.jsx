import React, { useRef, useCallback, useEffect, useContext, useState } from 'react';
import useStore from '../store';
import { TerminalHostContext } from '../TerminalHostContext';

export default function TerminalWindow() {
  const open = useStore((s) => s.terminalWindowOpen);
  const minimized = useStore((s) => s.terminalWindowMinimized);
  const maximized = useStore((s) => s.terminalWindowMaximized);
  const position = useStore((s) => s.terminalWindowPosition);
  const size = useStore((s) => s.terminalWindowSize);
  const terminalDocked = useStore((s) => s.terminalDocked);
  const closeTerminalWindow = useStore((s) => s.closeTerminalWindow);
  const minimizeTerminalWindow = useStore((s) => s.minimizeTerminalWindow);
  const maximizeTerminalWindow = useStore((s) => s.maximizeTerminalWindow);
  const setTerminalWindowPosition = useStore((s) => s.setTerminalWindowPosition);
  const setTerminalWindowSize = useStore((s) => s.setTerminalWindowSize);
  const setFocusedPanel = useStore((s) => s.setFocusedPanel);
  const dockTerminal = useStore((s) => s.dockTerminal);

  const terminalHost = useContext(TerminalHostContext);
  const windowRef = useRef(null);
  const bodyRef = useRef(null);
  const dragState = useRef(null);
  const [showDockIndicator, setShowDockIndicator] = useState(false);

  // Mount terminalHost into floating window body
  useEffect(() => {
    const el = bodyRef.current;
    if (el && terminalHost && !terminalDocked) {
      el.appendChild(terminalHost);
      // Trigger re-fit after DOM move settles
      const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
      return () => {
        clearTimeout(timer);
        if (terminalHost.parentNode === el) el.removeChild(terminalHost);
      };
    }
  }, [terminalHost, terminalDocked, open, minimized]);

  // ── Drag via titlebar with dock zone detection ──────────
  const onTitleMouseDown = useCallback((e) => {
    if (maximized || minimized) return;
    if (e.target.closest('.terminal-window__control-btn')) return;
    e.preventDefault();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };

    const onMouseMove = (ev) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = ev.clientX - ds.startX;
      const dy = ev.clientY - ds.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 120, ds.origX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, ds.origY + dy));
      setTerminalWindowPosition({ x: newX, y: newY });

      // Dock zone: left edge, between top-bar and bottom-bar
      const inDockZone = ev.clientX < 80 && ev.clientY > 40 && ev.clientY < window.innerHeight - 28;
      setShowDockIndicator(inDockZone);
    };

    const onMouseUp = (ev) => {
      const inDockZone = ev.clientX < 80 && ev.clientY > 40 && ev.clientY < window.innerHeight - 28;
      if (inDockZone) {
        dockTerminal();
      }
      setShowDockIndicator(false);
      dragState.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [maximized, minimized, position.x, position.y, setTerminalWindowPosition, dockTerminal]);

  // ── Track CSS resize via ResizeObserver ─────────────────
  useEffect(() => {
    const el = windowRef.current;
    if (!el || maximized || minimized) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setTerminalWindowSize({ width: Math.round(width), height: Math.round(height) });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [maximized, minimized, setTerminalWindowSize]);

  // Don't render when docked or closed
  if (terminalDocked || !open) return null;

  const cls = [
    'terminal-window',
    minimized && 'terminal-window--minimized',
    maximized && 'terminal-window--maximized',
  ].filter(Boolean).join(' ');

  const style = (!minimized && !maximized) ? {
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
  } : undefined;

  return (
    <div className="terminal-window-overlay">
      {showDockIndicator && (
        <div className="terminal-dock-indicator" />
      )}
      <div
        ref={windowRef}
        className={cls}
        style={style}
        onClick={() => setFocusedPanel('terminal')}
        role="region"
        aria-label="Terminal window"
      >
        <div
          className="terminal-window__titlebar"
          onMouseDown={onTitleMouseDown}
          onDoubleClick={maximizeTerminalWindow}
        >
          <div className="terminal-window__title-left">
            <span>Terminal</span>
          </div>
          <div className="terminal-window__controls">
            <button
              className="terminal-window__control-btn"
              onClick={minimizeTerminalWindow}
              aria-label={minimized ? 'Restore terminal' : 'Minimize terminal'}
              title={minimized ? 'Restore' : 'Minimize'}
            >
              &#8212;
            </button>
            <button
              className="terminal-window__control-btn"
              onClick={maximizeTerminalWindow}
              aria-label={maximized ? 'Restore terminal' : 'Maximize terminal'}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              &#9633;
            </button>
            <button
              className="terminal-window__control-btn terminal-window__control-btn--close"
              onClick={closeTerminalWindow}
              aria-label="Close terminal"
              title="Close"
            >
              &#10005;
            </button>
          </div>
        </div>
        <div className="terminal-window__body" ref={bodyRef} />
      </div>
    </div>
  );
}
