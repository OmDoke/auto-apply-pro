import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function ToastContainer({ toasts, removeToast }: { toasts: ToastMessage[], removeToast: (id: string) => void }) {
  return (
    <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} removeToast={removeToast} />
      ))}
    </div>
  );
}

function Toast({ toast, removeToast }: { toast: ToastMessage, removeToast: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => removeToast(toast.id), 5000);
    return () => clearTimeout(t);
  }, [toast.id, removeToast]);

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
    error: <AlertCircle className="w-5 h-5 text-rose-400" />,
    info: <Info className="w-5 h-5 text-indigo-400" />,
  };

  const bgStyles = {
    success: 'bg-emerald-500/10 border-emerald-500/20',
    error: 'bg-rose-500/10 border-rose-500/20',
    info: 'bg-indigo-500/10 border-indigo-500/20',
  };

  // Extract the actual message without the timestamp for cleaner display
  const displayMessage = toast.message.replace(/^\[.*?\]\s*/, '');

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border bg-slate-950/90 backdrop-blur-md pointer-events-auto shadow-2xl min-w-[300px] max-w-[400px] ${bgStyles[toast.type]} animate-[slideInRight_0.3s_ease-out]`}>
      <div className="shrink-0 mt-0.5">{icons[toast.type]}</div>
      <p className="text-sm font-medium text-slate-200 flex-1 break-words leading-relaxed">{displayMessage}</p>
      <button onClick={() => removeToast(toast.id)} className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors p-1 -mr-2 -mt-1 rounded-lg hover:bg-white/5">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
