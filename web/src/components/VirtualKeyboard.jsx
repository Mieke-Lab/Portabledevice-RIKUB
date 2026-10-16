import { useCallback, useEffect, useRef, useState } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { X } from 'lucide-react';

// Native setter bypasses React's tracked `.value` property so the subsequent
// 'input' event is seen as a real change and the component's onChange fires
// (plain `element.value = x` is swallowed silently by React's input tracker).
function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const { set: prototypeSetter } = Object.getOwnPropertyDescriptor(prototype, 'value') || {};
  if (prototypeSetter) prototypeSetter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

const NUMERIC_LAYOUT = {
  default: ['1 2 3', '4 5 6', '7 8 9', '- 0 .', '{bksp} {enter}'],
};

const TEXT_LAYOUT = {
  default: [
    'q w e r t y u i o p',
    'a s d f g h j k l',
    '{shift} z x c v b n m {bksp}',
    '{numbers} {space} . {enter}',
  ],
  shift: [
    'Q W E R T Y U I O P',
    'A S D F G H J K L',
    '{shift} Z X C V B N M {bksp}',
    '{numbers} {space} . {enter}',
  ],
  numbers: [
    '1 2 3 4 5 6 7 8 9 0',
    '- / : ; ( ) $ & @ "',
    '{shift2} . , ? ! \' {bksp}',
    '{abc} {space} {enter}',
  ],
};

const DISPLAY = {
  '{bksp}': '⌫',
  '{enter}': 'Enter',
  '{space}': ' ',
  '{shift}': '⇧',
  '{shift2}': '⇧',
  '{numbers}': '123',
  '{abc}': 'ABC',
};

function isTypeable(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return ['text', 'search', 'url', 'tel', 'number', 'email', ''].includes(el.type);
}

export function VirtualKeyboard() {
  const [target, setTarget] = useState(null);
  const [layoutName, setLayoutName] = useState('default');
  const keyboardRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    function onFocusIn(e) {
      if (isTypeable(e.target)) {
        setTarget(e.target);
        setLayoutName(e.target.type === 'number' ? 'default' : 'default');
      }
    }
    function onFocusOut(e) {
      // Ignore blur caused by clicking inside the keyboard itself.
      if (containerRef.current?.contains(e.relatedTarget)) return;
      setTarget(null);
    }
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (target && keyboardRef.current) {
      keyboardRef.current.setInput(target.value ?? '');
    }
  }, [target]);

  // Shrinks #root by the keyboard's real rendered height (see the matching
  // CSS rule) so pages using h-full/flex layouts reflow upward and the
  // focused field - typically pinned to the bottom, like a chat composer -
  // ends up above the keyboard instead of hidden behind it.
  useEffect(() => {
    if (!target || !containerRef.current) {
      document.documentElement.style.removeProperty('--keyboard-height');
      return;
    }
    const el = containerRef.current;
    const update = () => {
      document.documentElement.style.setProperty('--keyboard-height', `${el.offsetHeight}px`);
      target.scrollIntoView?.({ block: 'nearest' });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  const applyToTarget = useCallback(
    (nextValue, caretOffset = 0) => {
      if (!target) return;
      const pos = (target.selectionStart ?? nextValue.length) + caretOffset;
      setNativeValue(target, nextValue);
      target.setSelectionRange?.(pos, pos);
      target.focus();
    },
    [target],
  );

  const onKeyPress = useCallback(
    (button) => {
      if (!target) return;
      if (button === '{shift}' || button === '{shift2}') {
        setLayoutName((l) => (l === 'shift' ? 'default' : 'shift'));
        return;
      }
      if (button === '{numbers}') return setLayoutName('numbers');
      if (button === '{abc}') return setLayoutName('default');
      if (button === '{enter}') {
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
        );
        return;
      }
      if (button === '{bksp}') {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        const value = target.value ?? '';
        if (start === end && start > 0) {
          applyToTarget(value.slice(0, start - 1) + value.slice(end), -1);
        } else {
          applyToTarget(value.slice(0, start) + value.slice(end), 0);
        }
        return;
      }
      const char = button === '{space}' ? ' ' : button;
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const value = target.value ?? '';
      applyToTarget(value.slice(0, start) + char + value.slice(end), 1 - (end - start));
      if (layoutName === 'shift') setLayoutName('default');
    },
    [target, applyToTarget, layoutName],
  );

  if (!target) return null;

  const numeric = target.tagName === 'INPUT' && target.type === 'number';

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-[9999] border-t border-border bg-[#1c1f1e] px-2 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-4px_24px_rgba(0,0,0,0.35)]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-end pb-1">
        <button
          type="button"
          onClick={() => setTarget(null)}
          aria-label="Tutup keyboard"
          className="grid h-7 w-7 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mx-auto max-w-3xl virtual-keyboard-theme">
        <Keyboard
          keyboardRef={(r) => (keyboardRef.current = r)}
          layoutName={numeric ? 'default' : layoutName}
          layout={numeric ? NUMERIC_LAYOUT : TEXT_LAYOUT}
          display={DISPLAY}
          onKeyPress={onKeyPress}
          preventMouseDownDefault
          theme="hg-theme-default virtual-keyboard-theme"
        />
      </div>
    </div>
  );
}
