import { describe, expect, it } from 'vitest';
import { terminalHandlesKey } from '@/lib/research/terminalClipboard';

const key = (value: string, modifiers = {}) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...modifiers });
describe('console clipboard keyboard routing', () => {
  it('copies a terminal selection instead of interrupting, without cancelling the native browser event', () => {
    expect(terminalHandlesKey(key('c', {ctrlKey:true}), true)).toBe(false);
    expect(terminalHandlesKey(key('C', {ctrlKey:true,shiftKey:true}), true)).toBe(false);
  });
  it('preserves Ctrl+C/SIGINT without selection', () => {
    expect(terminalHandlesKey(key('c', {ctrlKey:true}), false)).toBe(true);
  });
  it.each([false,true])('leaves Ctrl+V and Cmd+V to the single native paste path (selection=%s)', selection => {
    for (const modifiers of [{ctrlKey:true},{metaKey:true},{ctrlKey:true,shiftKey:true},{metaKey:true,shiftKey:true}]) {
      expect(terminalHandlesKey(key('v', modifiers), selection)).toBe(false);
    }
  });
  it.each([false,true])('leaves Cmd+C to the browser, never SIGINT (selection=%s)', selection => {
    expect(terminalHandlesKey(key('c', {metaKey:true}), selection)).toBe(false);
  });
  it('does not intercept normal input, terminal control keys, AltGr or IME composition', () => {
    for (const event of [key('v'),key('c'),key('a',{ctrlKey:true}),key('d',{ctrlKey:true}),key('v',{ctrlKey:true,altKey:true}),key('c',{ctrlKey:true,metaKey:true}),key('v',{ctrlKey:true,isComposing:true})]) {
      expect(terminalHandlesKey(event, true)).toBe(true);
    }
  });
});
