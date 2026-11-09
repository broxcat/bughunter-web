'use client';
import { useEffect,useId,useRef,type ReactNode } from 'react';
import { Button } from './Button';
export function Dialog({title,onClose,children,compact=false}:{title:string;onClose:()=>void;children:ReactNode;compact?:boolean}){
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{
    const dialog=ref.current,opener=document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return()=>{dialog?.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus();};
  },[]);
  return <dialog ref={ref} aria-labelledby={id} onCancel={event=>{event.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} className={`ui-dialog m-auto max-h-[85dvh] ${compact?'w-[min(94vw,30rem)]':'w-[min(94vw,48rem)]'} overflow-y-auto rounded-lg border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/60`}><div className="ui-dialog-header mb-5 flex items-center gap-3"><h2 id={id} className="mr-auto text-xl font-semibold">{title}</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>{children}</dialog>;
}
