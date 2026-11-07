'use client';
import {useId,useState,type ReactNode} from 'react';
/** The CLI keeps Tab by default. An explicit mode lets keyboard users leave
 * xterm without changing CLI approval, provider or persistent session state. */
export default function ResearchKeyboardBoundary({children}:{children:ReactNode}){
 const [navigate,setNavigate]=useState(false),helpId=useId();
 return <div className="flex min-h-0 flex-1 flex-col" role="region" aria-label="Research console keyboard controls" aria-keyshortcuts="Control+Shift+M" onFocusCapture={event=>{
  if(event.target instanceof HTMLElement&&event.target.closest('.xterm')){
   const described=new Set((event.target.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean));described.add(helpId);event.target.setAttribute('aria-describedby',[...described].join(' '));
  }
 }} onKeyDownCapture={event=>{
  if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='m'){
   event.preventDefault();event.stopPropagation();setNavigate(value=>!value);
  }else if(navigate&&event.key==='Tab'&&event.target instanceof Element&&event.target.closest('.xterm')){
   // Stop xterm's input handler, while retaining the browser's native default
   // Tab/Shift+Tab traversal. Other terminal keys remain native CLI input.
   event.stopPropagation();
  }
 }}>
  <p id={helpId} role="status" className="shrink-0 border-b border-border bg-surface px-3 py-1 text-xs text-foreground">Ctrl+Shift+M: toggle Tab navigation. {navigate?'Tab navigation enabled; Tab moves between controls.':'Terminal input enabled; Tab is sent to the CLI.'}</p>
  <div aria-describedby={helpId} className="min-h-0 flex-1 [&>div]:h-full">{children}</div>
 </div>;
}
