'use client';
import { useEffect,useId,useRef,type ReactNode } from 'react';
import { Button } from './Button';
export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{
    const dialog=ref.current,opener=document.activeElement;
    dialog?.showModal();
    return()=>{dialog?.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus();};
  },[]);
  return <dialog ref={ref} aria-labelledby={id} onCancel={event=>{event.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} className="m-auto max-h-[85dvh] w-[min(94vw,48rem)] overflow-y-auto rounded-lg border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/60"><div className="mb-5 flex items-center gap-3"><h2 id={id} className="mr-auto text-xl font-semibold">{title}</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>{children}</dialog>;
}
